import assert from "node:assert/strict";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/hutch-storage-client";
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

/** Records write commands and optionally fails every send with a given error. */
function createWriteFakeClient(opts: { fail?: Error } = {}): {
	client: DynamoDBDocumentClient;
	commands: CapturedCommand[];
} {
	const commands: CapturedCommand[] = [];
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			commands.push({ name: command.constructor.name, input: command.input });
			if (opts.fail) throw opts.fail;
			if (command.constructor.name === "ScanCommand") return { Count: 3 };
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

function cancelled(codes: (string | undefined)[]): TransactionCanceledException {
	return new TransactionCanceledException({
		$metadata: {},
		message: "transaction cancelled",
		CancellationReasons: codes.map((Code) => ({ Code })),
	});
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

	describe("createUser", () => {
		it("writes the user row and canonical claim in one transaction for Gmail", async () => {
			const { client, commands } = createWriteFakeClient();

			const result = await initAuth(client).createUser({
				email: "John.Doe+promo@gmail.com",
				password: "password123",
			});

			assert(result.ok, "create should succeed");
			const tx = commands.find((c) => c.name === "TransactWriteCommand");
			expect(tx?.input).toMatchObject({
				TransactItems: [
					{
						Put: {
							Item: {
								email: "john.doe+promo@gmail.com",
								userId: result.userId,
								canonicalEmail: "johndoe@gmail.com",
							},
							ConditionExpression: "attribute_not_exists(email)",
						},
					},
					{
						Put: {
							Item: { email: "canonical#johndoe@gmail.com", ownerUserId: result.userId },
							ConditionExpression: "attribute_not_exists(email)",
						},
					},
				],
			});
		});

		it("writes a single conditional put (no transaction) for a non-Gmail address", async () => {
			const { client, commands } = createWriteFakeClient();

			const result = await initAuth(client).createUser({
				email: "user@example.com",
				password: "password123",
			});

			expect(result.ok).toBe(true);
			expect(commands.some((c) => c.name === "TransactWriteCommand")).toBe(false);
			const put = commands.find((c) => c.name === "PutCommand");
			expect(put?.input).toMatchObject({
				Item: { email: "user@example.com", canonicalEmail: "user@example.com" },
				ConditionExpression: "attribute_not_exists(email)",
			});
		});

		it("maps a Gmail transaction cancelled on the delivery-email key to email-already-exists", async () => {
			const { client } = createWriteFakeClient({ fail: cancelled(["ConditionalCheckFailed", "None"]) });

			const result = await initAuth(client).createUser({
				email: "john.doe@gmail.com",
				password: "password123",
			});

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});

		it("maps a Gmail transaction cancelled on the canonical-claim key to email-already-exists", async () => {
			const { client } = createWriteFakeClient({ fail: cancelled(["None", "ConditionalCheckFailed"]) });

			const result = await initAuth(client).createUser({
				email: "john.doe@gmail.com",
				password: "password123",
			});

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});

		it("rethrows a Gmail transaction cancelled for a non-conditional reason (e.g. throttling)", async () => {
			const { client } = createWriteFakeClient({ fail: cancelled(["ThrottlingError", "None"]) });

			await expect(
				initAuth(client).createUser({
					email: "john.doe@gmail.com",
					password: "password123",
				}),
			).rejects.toThrow(TransactionCanceledException);
		});

		it("maps a conditional-check failure on a non-Gmail put to email-already-exists", async () => {
			const { client } = createWriteFakeClient({
				fail: new ConditionalCheckFailedException({ $metadata: {}, message: "exists" }),
			});

			const result = await initAuth(client).createUser({
				email: "user@example.com",
				password: "password123",
			});

			expect(result).toEqual({ ok: false, reason: "email-already-exists" });
		});
	});

	describe("countUsers", () => {
		it("counts only delivery rows, filtering out claim items", async () => {
			const { client, commands } = createWriteFakeClient();

			const count = await initAuth(client).countUsers();

			expect(count).toBe(3);
			const scan = commands.find((c) => c.name === "ScanCommand");
			expect(scan?.input).toMatchObject({
				Select: "COUNT",
				FilterExpression: "attribute_exists(userId)",
			});
		});
	});
});
