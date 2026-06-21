import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { UserIdSchema } from "@packages/domain/user";
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

/** Records commands and replays a single queried user row (or none). */
function createQueryFakeClient(opts: {
	row?: Record<string, unknown>;
}): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "QueryCommand") {
				return { Items: opts.row ? [opts.row] : [], Count: opts.row ? 1 : 0 };
			}
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

const USER = UserIdSchema.parse("abc123");

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

	describe("findUserContactByUserId", () => {
		it("returns email and verification status via the userId-index", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123", emailVerified: true },
			});

			const contact = await initAuth(client).findUserContactByUserId(USER);

			expect(contact).toEqual({ email: "user@example.com", emailVerified: true });
			expect(commands.find((c) => c.name === "QueryCommand")?.input.IndexName).toBe("userId-index");
		});

		it("returns null when no row exists for the id", async () => {
			const { client } = createQueryFakeClient({});

			const contact = await initAuth(client).findUserContactByUserId(USER);

			expect(contact).toBeNull();
		});
	});

	describe("findUserById", () => {
		it("returns id, verification status, and registeredAt via the userId-index", async () => {
			const { client, commands } = createQueryFakeClient({
				row: {
					email: "user@example.com",
					userId: "abc123",
					emailVerified: true,
					registeredAt: "2026-04-20T00:00:00.000Z",
				},
			});

			const user = await initAuth(client).findUserById(USER);

			expect(user).toEqual({
				userId: "abc123",
				emailVerified: true,
				registeredAt: "2026-04-20T00:00:00.000Z",
			});
			expect(commands.find((c) => c.name === "QueryCommand")?.input.IndexName).toBe("userId-index");
		});

		it("returns null when no row exists for the id", async () => {
			const { client } = createQueryFakeClient({});

			const user = await initAuth(client).findUserById(USER);

			expect(user).toBeNull();
		});
	});
});
