import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import { initDynamoDbPasswordReset } from "./dynamodb-password-reset";

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records commands and replays the row a DeleteCommand with ReturnValues:ALL_OLD
 * would return, or throws a supplied error so the rejection paths can be asserted. */
function createFakeClient(opts: {
	deleteAttributes?: Record<string, unknown>;
	deleteError?: Error;
}): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "DeleteCommand") {
				if (opts.deleteError) throw opts.deleteError;
				return opts.deleteAttributes ? { Attributes: opts.deleteAttributes } : {};
			}
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

interface ScanPage {
	Items: Record<string, unknown>[];
	LastEvaluatedKey?: Record<string, unknown>;
}

/** Replays a queue of Scan pages in order and records every command so the
 * scan filter and the per-token deletes can be asserted. */
function createScanClient(pages: ScanPage[]): {
	client: DynamoDBDocumentClient;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	let scanCall = 0;
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "ScanCommand") return pages[scanCall++];
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

const TABLE = "password-reset-tokens";

function initStore(client: DynamoDBDocumentClient) {
	return initDynamoDbPasswordReset({ client, tableName: TABLE });
}

describe("initDynamoDbPasswordReset", () => {
	describe("createPasswordResetToken", () => {
		it("puts a 64-hex token keyed by email with a one-hour TTL", async () => {
			const { client, commands } = createFakeClient({});

			const before = Math.floor(Date.now() / 1000);
			const token = await initStore(client).createPasswordResetToken({
				email: "user@example.com",
			});
			const after = Math.floor(Date.now() / 1000);

			expect(token).toMatch(/^[0-9a-f]{64}$/);
			const put = commands.find((c) => c.name === "PutCommand");
			expect(put?.input.TableName).toBe(TABLE);
			const item = put?.input.Item as { token: string; email: string; expiresAt: number };
			expect(item.token).toBe(token);
			expect(item.email).toBe("user@example.com");
			expect(item.expiresAt).toBeGreaterThanOrEqual(before + 60 * 60);
			expect(item.expiresAt).toBeLessThanOrEqual(after + 60 * 60);
		});
	});

	describe("verifyPasswordResetToken", () => {
		it("consumes the token and returns the email when it exists and is unexpired", async () => {
			const token = await initStore(createFakeClient({}).client).createPasswordResetToken({
				email: "user@example.com",
			});
			const future = Math.floor(Date.now() / 1000) + 60 * 60;
			const { client, commands } = createFakeClient({
				deleteAttributes: { token, email: "user@example.com", expiresAt: future },
			});

			const result = await initStore(client).verifyPasswordResetToken(token);

			expect(result).toEqual({ ok: true, email: "user@example.com" });
			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input.Key).toEqual({ token });
			expect(del?.input.ConditionExpression).toContain("attribute_exists(#tk)");
			expect(del?.input.ReturnValues).toBe("ALL_OLD");
		});

		it("rejects an expired token even though the row still existed", async () => {
			const token = await initStore(createFakeClient({}).client).createPasswordResetToken({
				email: "user@example.com",
			});
			const past = Math.floor(Date.now() / 1000) - 1;
			const { client } = createFakeClient({
				deleteAttributes: { token, email: "user@example.com", expiresAt: past },
			});

			expect(await initStore(client).verifyPasswordResetToken(token)).toEqual({
				ok: false,
				reason: "invalid-token",
			});
		});

		it("rejects when the attribute_exists condition fails (token already consumed or absent)", async () => {
			const token = await initStore(createFakeClient({}).client).createPasswordResetToken({
				email: "user@example.com",
			});
			const { client } = createFakeClient({
				deleteError: new ConditionalCheckFailedException({ $metadata: {}, message: "missing" }),
			});

			expect(await initStore(client).verifyPasswordResetToken(token)).toEqual({
				ok: false,
				reason: "invalid-token",
			});
		});

		it("rethrows non-conditional delete errors", async () => {
			const token = await initStore(createFakeClient({}).client).createPasswordResetToken({
				email: "user@example.com",
			});
			const { client } = createFakeClient({ deleteError: new Error("throttled") });

			await expect(initStore(client).verifyPasswordResetToken(token)).rejects.toThrow(
				"throttled",
			);
		});
	});

	describe("deleteTokensByEmail", () => {
		it("scans every page filtering by email and deletes each token by its primary key", async () => {
			const { client, commands } = createScanClient([
				{
					Items: [{ token: "aaa" }, { token: "bbb" }],
					LastEvaluatedKey: { token: "bbb" },
				},
				{ Items: [{ token: "ccc" }] },
			]);

			await initStore(client).deleteTokensByEmail("user@example.com");

			const scans = commands.filter((c) => c.name === "ScanCommand");
			expect(scans).toHaveLength(2);
			expect(scans[0]?.input.TableName).toBe(TABLE);
			expect(scans[0]?.input.FilterExpression).toBe("email = :e");
			expect(scans[0]?.input.ExpressionAttributeValues).toEqual({ ":e": "user@example.com" });
			expect(scans[0]?.input.ProjectionExpression).toBe("#tk");
			expect(scans[0]?.input.ExpressionAttributeNames).toEqual({ "#tk": "token" });
			expect(scans[0]?.input.ExclusiveStartKey).toBeUndefined();
			expect(scans[1]?.input.ExclusiveStartKey).toEqual({ token: "bbb" });

			const deletes = commands.filter((c) => c.name === "DeleteCommand");
			expect(deletes.map((d) => d.input.Key)).toEqual([
				{ token: "aaa" },
				{ token: "bbb" },
				{ token: "ccc" },
			]);
		});

		it("issues no deletes when the email matches no tokens", async () => {
			const { client, commands } = createScanClient([{ Items: [] }]);

			await initStore(client).deleteTokensByEmail("nobody@example.com");

			expect(commands.filter((c) => c.name === "ScanCommand")).toHaveLength(1);
			expect(commands.filter((c) => c.name === "DeleteCommand")).toHaveLength(0);
		});
	});
});
