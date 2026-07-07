import { z } from "zod";
import { ConditionalCheckFailedException, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
import { VerificationTokenSchema } from "@packages/provider-contracts/email-verification";
import { initDynamoDbEmailVerification } from "./dynamodb-email-verification";

const USER = UserIdSchema.parse("abc123");
const TOKEN = VerificationTokenSchema.parse("a".repeat(64));

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

type CommandResponse = Record<string, unknown> | (() => Record<string, unknown>);

/** Records every command sent and replays a canned response keyed by command
 * type, so a test can assert the exact ConditionExpression / ReturnValues the
 * provider builds. A function response is invoked so a test can throw to
 * simulate a failed conditional delete. */
function createFakeClient(
	responses: Partial<Record<string, CommandResponse>> = {},
): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			const response = responses[name];
			if (!response) return {};
			return typeof response === "function" ? response() : response;
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function initVerification(client: DynamoDBDocumentClient) {
	return initDynamoDbEmailVerification({ client, tableName: "verifications" });
}

function rowAttributes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		Attributes: {
			token: TOKEN,
			userId: USER,
			email: "user@example.com",
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
			...overrides,
		},
	};
}

describe("initDynamoDbEmailVerification", () => {
	describe("createVerificationToken", () => {
		it("persists a 64-char hex token and returns it", async () => {
			const { client, commands } = createFakeClient();

			const token = await initVerification(client).createVerificationToken({
				userId: USER,
				email: "user@example.com",
			});

			expect(token).toMatch(/^[0-9a-f]{64}$/);
			const put = commands.find((c) => c.name === "PutCommand");
			expect(put?.input.Item).toMatchObject({ token, userId: USER, email: "user@example.com" });
			const { expiresAt } = z.object({ expiresAt: z.number() }).parse(put?.input.Item);
			expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
		});
	});

	describe("verifyEmailToken", () => {
		it("returns the user and email when the deleted token is still valid", async () => {
			const { client, commands } = createFakeClient({ DeleteCommand: rowAttributes() });

			const result = await initVerification(client).verifyEmailToken(TOKEN);

			expect(result).toEqual({ ok: true, userId: USER, email: "user@example.com" });
			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input.ReturnValues).toBe("ALL_OLD");
			expect(del?.input.ConditionExpression).toContain("attribute_exists");
		});

		it("rejects with invalid-token when no row was deleted", async () => {
			const { client } = createFakeClient({ DeleteCommand: {} });

			const result = await initVerification(client).verifyEmailToken(TOKEN);

			expect(result).toEqual({ ok: false, reason: "invalid-token" });
		});

		it("rejects with invalid-token when the deleted token has expired", async () => {
			const { client } = createFakeClient({
				DeleteCommand: rowAttributes({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
			});

			const result = await initVerification(client).verifyEmailToken(TOKEN);

			expect(result).toEqual({ ok: false, reason: "invalid-token" });
		});

		it("rejects with invalid-token when the conditional delete finds no token", async () => {
			const { client } = createFakeClient({
				DeleteCommand: () => {
					throw new ConditionalCheckFailedException({ $metadata: {}, message: "missing" });
				},
			});

			const result = await initVerification(client).verifyEmailToken(TOKEN);

			expect(result).toEqual({ ok: false, reason: "invalid-token" });
		});

		it("propagates errors that are not a failed condition", async () => {
			const failure = new Error("throttled");
			const { client } = createFakeClient({
				DeleteCommand: () => {
					throw failure;
				},
			});

			await expect(initVerification(client).verifyEmailToken(TOKEN)).rejects.toThrow(failure);
		});
	});

	describe("deleteTokensByUserId", () => {
		it("scans by userId across pages and deletes each token by its primary key", async () => {
			const pages = [
				{ Items: [{ token: "t1" }, { token: "t2" }], LastEvaluatedKey: { token: "t2" } },
				{ Items: [{ token: "t3" }] },
			];
			let call = 0;
			const { client, commands } = createFakeClient({ ScanCommand: () => pages[call++] });

			await initVerification(client).deleteTokensByUserId(USER);

			const scans = commands.filter((c) => c.name === "ScanCommand");
			expect(scans).toHaveLength(2);
			expect(scans[0]?.input.FilterExpression).toBe("userId = :u");
			expect(scans[0]?.input.ExpressionAttributeValues).toEqual({ ":u": USER });
			expect(scans[0]?.input.ProjectionExpression).toBe("#tk");
			expect(scans[0]?.input.ExpressionAttributeNames).toEqual({ "#tk": "token" });
			expect(scans[1]?.input.ExclusiveStartKey).toEqual({ token: "t2" });

			const deletes = commands.filter((c) => c.name === "DeleteCommand");
			expect(deletes.map((d) => d.input.Key)).toEqual([
				{ token: "t1" },
				{ token: "t2" },
				{ token: "t3" },
			]);
		});

		it("issues no deletes when the user has no verification tokens", async () => {
			const { client, commands } = createFakeClient({ ScanCommand: { Items: [] } });

			await initVerification(client).deleteTokensByUserId(USER);

			expect(commands.filter((c) => c.name === "ScanCommand")).toHaveLength(1);
			expect(commands.filter((c) => c.name === "DeleteCommand")).toHaveLength(0);
		});
	});
});
