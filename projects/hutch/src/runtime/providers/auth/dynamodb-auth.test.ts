import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
} from "@packages/hutch-storage-client";
import type { UserId } from "@packages/domain/user";
import { initDynamoDbAuth } from "./dynamodb-auth";

/** Fake that honours the GetCommand projection so a row with fields missing from it round-trips as real DynamoDB would. */
function createFakeClient(
	storedRow: Record<string, unknown>,
): Partial<DynamoDBDocumentClient> {
	return {
		send: (async (command: {
			input: { ExpressionAttributeNames: Record<string, string> };
		}) => {
			const attrs = Object.values(command.input.ExpressionAttributeNames);
			const Item = Object.fromEntries(attrs.map((a) => [a, storedRow[a]]));
			return { Item };
		}) as DynamoDBDocumentClient["send"],
	};
}

interface CapturedCommand {
	name: string;
	input: Record<string, unknown>;
}

/** Records commands and replays a single queried user row, optionally failing
 * the conditional update so the cooldown-rejected path can be asserted. */
function createClaimFakeClient(opts: {
	row?: Record<string, unknown>;
	updateError?: Error;
}): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "QueryCommand") {
				return { Items: opts.row ? [opts.row] : [], Count: opts.row ? 1 : 0 };
			}
			if (name === "UpdateCommand" && opts.updateError) throw opts.updateError;
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function initAuth(client: DynamoDBDocumentClient) {
	return initDynamoDbAuth({
		client,
		usersTableName: "users",
		sessionsTableName: "sessions",
	});
}

const USER = "abc123" as UserId;

describe("initDynamoDbAuth", () => {
	describe("findUserByEmail", () => {
		it("returns the user when the row exists", async () => {
			const client = createFakeClient({
				email: "existing@example.com",
				userId: "abc123",
				passwordHash: "hashed",
				emailVerified: true,
				registeredAt: "2026-04-20T00:00:00.000Z",
			});
			const auth = initDynamoDbAuth({
				client: client as typeof client & DynamoDBDocumentClient,
				usersTableName: "users",
				sessionsTableName: "sessions",
			});

			const result = await auth.findUserByEmail("existing@example.com");

			expect(result).toEqual({
				userId: "abc123",
				emailVerified: true,
				registeredAt: "2026-04-20T00:00:00.000Z",
			});
		});
	});

	describe("userExistsByEmail", () => {
		it("returns true when a matching row exists", async () => {
			const client: Partial<DynamoDBDocumentClient> = {
				send: (async () => ({ Count: 1 })) as DynamoDBDocumentClient["send"],
			};
			const auth = initDynamoDbAuth({
				client: client as typeof client & DynamoDBDocumentClient,
				usersTableName: "users",
				sessionsTableName: "sessions",
			});

			const exists = await auth.userExistsByEmail("existing@example.com");

			expect(exists).toBe(true);
		});

		it("returns false when no row matches", async () => {
			const client: Partial<DynamoDBDocumentClient> = {
				send: (async () => ({ Count: 0 })) as DynamoDBDocumentClient["send"],
			};
			const auth = initDynamoDbAuth({
				client: client as typeof client & DynamoDBDocumentClient,
				usersTableName: "users",
				sessionsTableName: "sessions",
			});

			const exists = await auth.userExistsByEmail("missing@example.com");

			expect(exists).toBe(false);
		});
	});

	describe("claimReaderReadyEmailSlot", () => {
		const COOLDOWN_MS = 6 * 60 * 60 * 1000;

		it("resolves the row by userId-index then claims on the email PK with the cooldown condition", async () => {
			const { client, commands } = createClaimFakeClient({
				row: { email: "user@example.com", userId: "abc123", emailVerified: true },
			});

			const claimed = await initAuth(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(true);
			const query = commands.find((c) => c.name === "QueryCommand");
			expect(query?.input.IndexName).toBe("userId-index");
			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input.Key).toEqual({ email: "user@example.com" });
			expect(update?.input.ConditionExpression).toBe(
				"attribute_not_exists(lastReaderReadyEmailAt) OR lastReaderReadyEmailAt < :cutoff",
			);
			expect((update?.input.ExpressionAttributeValues as Record<string, unknown>)[":cutoff"]).toBe(
				"2026-05-30T04:00:00.000Z",
			);
		});

		it("returns false when the conditional update fails (still inside the cooldown window)", async () => {
			const { client } = createClaimFakeClient({
				row: { email: "user@example.com", userId: "abc123", emailVerified: true },
				updateError: new ConditionalCheckFailedException({ $metadata: {}, message: "cooldown" }),
			});

			const claimed = await initAuth(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(false);
		});

		it("returns false without an update when no user row exists for the id", async () => {
			const { client, commands } = createClaimFakeClient({});

			const claimed = await initAuth(client).claimReaderReadyEmailSlot({
				userId: USER,
				now: new Date("2026-05-30T10:00:00.000Z"),
				cooldownMs: COOLDOWN_MS,
			});

			expect(claimed).toBe(false);
			expect(commands.some((c) => c.name === "UpdateCommand")).toBe(false);
		});

		it("rethrows non-conditional update errors", async () => {
			const { client } = createClaimFakeClient({
				row: { email: "user@example.com", userId: "abc123", emailVerified: true },
				updateError: new Error("throttled"),
			});

			await expect(
				initAuth(client).claimReaderReadyEmailSlot({
					userId: USER,
					now: new Date("2026-05-30T10:00:00.000Z"),
					cooldownMs: COOLDOWN_MS,
				}),
			).rejects.toThrow("throttled");
		});
	});

	describe("findUserContactByUserId", () => {
		it("returns email and verification status via the userId-index", async () => {
			const { client, commands } = createClaimFakeClient({
				row: { email: "user@example.com", userId: "abc123", emailVerified: true },
			});

			const contact = await initAuth(client).findUserContactByUserId(USER);

			expect(contact).toEqual({ email: "user@example.com", emailVerified: true });
			expect(commands.find((c) => c.name === "QueryCommand")?.input.IndexName).toBe("userId-index");
		});

		it("returns null when no row exists for the id", async () => {
			const { client } = createClaimFakeClient({});

			const contact = await initAuth(client).findUserContactByUserId(USER);

			expect(contact).toBeNull();
		});
	});
});
