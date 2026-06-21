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
			expect(del?.input.ConditionExpression).toBe("attribute_exists(#tk)");
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
});
