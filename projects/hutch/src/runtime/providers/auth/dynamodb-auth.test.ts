import assert from "node:assert/strict";
import { z } from "zod";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactionCanceledException,
} from "@packages/hutch-storage-client";
import { OAuthGrantIdSchema } from "@packages/domain/oauth";
import { DisplayNameSchema, UserIdSchema } from "@packages/domain/user";
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

/** Replays a sequence of query pages: each page carries its rows and the
 * LastEvaluatedKey that drives the next iteration (omitted on the final page to
 * end pagination). Queries past the last page replay the final page, so
 * single-page fakes serve any number of independent queries. */
function createPaginatedQueryFakeClient(
	pages: { rows: Record<string, unknown>[]; lastEvaluatedKey?: Record<string, unknown> }[],
	opts: { onDelete?: (input: Record<string, unknown>) => Promise<unknown> } = {},
): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	const commands: CapturedCommand[] = [];
	let queryCount = 0;
	const client = {
		send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
			const name = command.constructor.name;
			commands.push({ name, input: command.input });
			if (name === "QueryCommand") {
				const page = pages[Math.min(queryCount, pages.length - 1)];
				queryCount += 1;
				return { Items: page.rows, Count: page.rows.length, LastEvaluatedKey: page.lastEvaluatedKey };
			}
			if (name === "DeleteCommand" && opts.onDelete) return opts.onDelete(command.input);
			return {};
		}) as DynamoDBDocumentClient["send"],
	};
	return { client: client as typeof client & DynamoDBDocumentClient, commands };
}

/** Records commands and replays a single queried user row (or none). */
function createQueryFakeClient(opts: {
	row?: Record<string, unknown>;
}): { client: DynamoDBDocumentClient; commands: CapturedCommand[] } {
	return createPaginatedQueryFakeClient([{ rows: opts.row ? [opts.row] : [] }]);
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
		observeSession: () => {},
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
		observeSession: () => {},
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

	describe("findUserByEmail — deletion in flight", () => {
		it("returns null for a row carrying deletedAt, so a deleted account cannot be signed back into", async () => {
			const client = createFakeClient({
				email: "gone@example.com",
				userId: "abc123",
				emailVerified: true,
				registeredAt: "2026-04-20T00:00:00.000Z",
				deletedAt: "2026-08-31T00:00:00.000Z",
			});
			const auth = initDynamoDbAuth({
		observeSession: () => {},
				client: client as typeof client & DynamoDBDocumentClient,
				usersTableName: "users",
				sessionsTableName: "sessions",
			});

			const result = await auth.findUserByEmail("gone@example.com");

			expect(result).toBeNull();
		});
	});

	describe("verifyCredentials — deletion in flight", () => {
		it("refuses a correct password once the row carries deletedAt", async () => {
			const storedRow = {
				email: "gone@example.com",
				userId: "abc123",
				passwordHash: "hashed",
				emailVerified: true,
				deletedAt: "2026-08-31T00:00:00.000Z",
			};
			const client = {
				send: (async () => ({ Item: storedRow })) as DynamoDBDocumentClient["send"],
			};
			const auth = initAuth(client as typeof client & DynamoDBDocumentClient);

			const result = await auth.verifyCredentials({
				email: "gone@example.com",
				password: "password",
			});

			expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
		});
	});

	describe("markAccountDeleted", () => {
		it("tombstones the row set-once and conditionally, so a deleted account cannot resurrect or lose its marker", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123" },
			});

			await initAuth(client).markAccountDeleted({
				userId: USER,
				at: "2026-08-31T00:00:00.000Z",
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input).toMatchObject({
				Key: { email: "user@example.com" },
				UpdateExpression: "SET deletedAt = if_not_exists(deletedAt, :at)",
				ConditionExpression: "attribute_exists(email)",
				ExpressionAttributeValues: { ":at": "2026-08-31T00:00:00.000Z" },
			});
		});

		it("no-ops when the user row is already gone, so a stale session cannot 500 the delete route", async () => {
			const { client, commands } = createQueryFakeClient({});

			await initAuth(client).markAccountDeleted({
				userId: USER,
				at: "2026-08-31T00:00:00.000Z",
			});

			expect(commands.find((c) => c.name === "UpdateCommand")).toBeUndefined();
		});
	});

	describe("userExistsByEmail", () => {
		it("returns true when a matching row exists", async () => {
			const client: Partial<DynamoDBDocumentClient> = {
				send: (async () => ({ Count: 1 })) as DynamoDBDocumentClient["send"],
			};
			const auth = initDynamoDbAuth({
		observeSession: () => {},
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
		observeSession: () => {},
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

		it("carries the deletion instant so background senders can tell an account being erased", async () => {
			const { client } = createQueryFakeClient({
				row: {
					email: "user@example.com",
					userId: "abc123",
					emailVerified: true,
					deletedAt: "2026-10-10T12:00:00.000Z",
				},
			});

			const contact = await initAuth(client).findUserContactByUserId(USER);

			expect(contact?.deletedAt).toBe("2026-10-10T12:00:00.000Z");
		});

		it("carries the queue digest opt-out instant from the row", async () => {
			const { client } = createQueryFakeClient({
				row: {
					email: "user@example.com",
					userId: "abc123",
					emailVerified: true,
					queueDigestOptOutAt: "2026-09-30T10:00:00.000Z",
				},
			});

			const contact = await initAuth(client).findUserContactByUserId(USER);

			expect(contact).toStrictEqual({
				email: "user@example.com",
				emailVerified: true,
				queueDigestOptOutAt: "2026-09-30T10:00:00.000Z",
				deletedAt: undefined,
			});
		});

		it("reports no queue digest opt-out for a row that never opted out", async () => {
			const { client } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123", emailVerified: true },
			});

			const contact = await initAuth(client).findUserContactByUserId(USER);

			expect(contact).toStrictEqual({
				email: "user@example.com",
				emailVerified: true,
				queueDigestOptOutAt: undefined,
				deletedAt: undefined,
			});
		});
	});

	describe("setQueueDigestOptOut", () => {
		it("sets the opt-out instant conditionally on the user's row, so a deleted account cannot be resurrected", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123" },
			});

			await initAuth(client).setQueueDigestOptOut({
				userId: USER,
				optedOutAt: "2026-09-30T10:00:00.000Z",
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input).toStrictEqual({
				TableName: "users",
				Key: { email: "user@example.com" },
				UpdateExpression: "SET queueDigestOptOutAt = :optedOutAt",
				ConditionExpression: "attribute_exists(email)",
				ExpressionAttributeValues: { ":optedOutAt": "2026-09-30T10:00:00.000Z" },
			});
		});

		it("removes the opt-out instant when opting back in", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123" },
			});

			await initAuth(client).setQueueDigestOptOut({ userId: USER, optedOutAt: undefined });

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input).toStrictEqual({
				TableName: "users",
				Key: { email: "user@example.com" },
				UpdateExpression: "REMOVE queueDigestOptOutAt",
				ConditionExpression: "attribute_exists(email)",
			});
		});

		it("no-ops when the user row is already gone", async () => {
			const { client, commands } = createQueryFakeClient({});

			await initAuth(client).setQueueDigestOptOut({
				userId: USER,
				optedOutAt: "2026-09-30T10:00:00.000Z",
			});

			expect(commands.map((c) => c.name)).toEqual(["QueryCommand"]);
		});
	});

	describe("setUserDisplayName", () => {
		it("sets the display name conditionally on the user's row, so a deleted account cannot be resurrected", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123" },
			});

			await initAuth(client).setUserDisplayName({
				userId: USER,
				displayName: DisplayNameSchema.parse("James Davis"),
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input).toStrictEqual({
				TableName: "users",
				Key: { email: "user@example.com" },
				UpdateExpression: "SET displayName = :displayName",
				ConditionExpression: "attribute_exists(email)",
				ExpressionAttributeValues: { ":displayName": "James Davis" },
			});
		});

		it("removes the display name when it is cleared", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123" },
			});

			await initAuth(client).setUserDisplayName({ userId: USER, displayName: undefined });

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input).toStrictEqual({
				TableName: "users",
				Key: { email: "user@example.com" },
				UpdateExpression: "REMOVE displayName",
				ConditionExpression: "attribute_exists(email)",
			});
		});

		it("no-ops when the user row is already gone", async () => {
			const { client, commands } = createQueryFakeClient({});

			await initAuth(client).setUserDisplayName({
				userId: USER,
				displayName: DisplayNameSchema.parse("James Davis"),
			});

			expect(commands.map((c) => c.name)).toEqual(["QueryCommand"]);
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
				email: "user@example.com",
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

		it("carries the deletion instant so background jobs can tell an account being erased", async () => {
			const { client } = createQueryFakeClient({
				row: {
					email: "user@example.com",
					userId: "abc123",
					emailVerified: true,
					registeredAt: "2026-04-20T00:00:00.000Z",
					deletedAt: "2026-10-10T12:00:00.000Z",
				},
			});

			const user = await initAuth(client).findUserById(USER);

			expect(user?.deletedAt).toBe("2026-10-10T12:00:00.000Z");
		});

		it("carries the display name the reader set, so the header can name them", async () => {
			const { client } = createQueryFakeClient({
				row: {
					email: "user@example.com",
					userId: "abc123",
					emailVerified: true,
					registeredAt: "2026-04-20T00:00:00.000Z",
					displayName: "James Davis",
				},
			});

			const user = await initAuth(client).findUserById(USER);

			expect(user).toEqual({
				userId: "abc123",
				email: "user@example.com",
				emailVerified: true,
				registeredAt: "2026-04-20T00:00:00.000Z",
				displayName: "James Davis",
			});
		});
	});

	describe("findUserPasswordStatus", () => {
		it("reports the password and when it last changed via the userId-index", async () => {
			const { client, commands } = createQueryFakeClient({
				row: {
					email: "user@example.com",
					userId: "abc123",
					passwordHash: "hashed",
					passwordUpdatedAt: "2026-04-18T09:30:00.000Z",
				},
			});

			const status = await initAuth(client).findUserPasswordStatus(USER);

			expect(status).toEqual({ kind: "set", updatedAt: "2026-04-18T09:30:00.000Z" });
			expect(commands.find((c) => c.name === "QueryCommand")?.input.IndexName).toBe("userId-index");
		});

		it("reports a password with no known change time for a row written before the stamp existed", async () => {
			const { client } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123", passwordHash: "hashed" },
			});

			const status = await initAuth(client).findUserPasswordStatus(USER);

			expect(status).toEqual({ kind: "set", updatedAt: undefined });
		});

		it("reports no password for an account that signs in with Google or Apple", async () => {
			const { client } = createQueryFakeClient({
				row: { email: "user@example.com", userId: "abc123", emailVerified: true },
			});

			const status = await initAuth(client).findUserPasswordStatus(USER);

			expect(status).toEqual({ kind: "not-set" });
		});

		it("returns null when no row exists for the id", async () => {
			const { client } = createQueryFakeClient({});

			const status = await initAuth(client).findUserPasswordStatus(USER);

			expect(status).toBeNull();
		});
	});

	describe("updatePassword", () => {
		it("records when the password changed together with the new hash, conditionally so a deleted account cannot be resurrected", async () => {
			const { client, commands } = createWriteFakeClient();

			await initAuth(client).updatePassword({
				email: "User@Example.com",
				password: "a-new-password",
				updatedAt: "2026-10-15T08:00:00.000Z",
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input).toMatchObject({
				Key: { email: "user@example.com" },
				UpdateExpression: "SET passwordHash = :hash, passwordUpdatedAt = :updatedAt",
				ConditionExpression: "attribute_exists(email)",
				ExpressionAttributeValues: { ":hash": expect.any(String), ":updatedAt": "2026-10-15T08:00:00.000Z" },
			});
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

		it("records the password as changed at the instant the account was registered", async () => {
			const { client, commands } = createWriteFakeClient();

			await initAuth(client).createUser({ email: "user@example.com", password: "password123" });

			const item = commands.find((c) => c.name === "PutCommand")?.input.Item;
			assert(item && typeof item === "object", "expected a PutCommand item");
			const { registeredAt, passwordUpdatedAt } = Object.fromEntries(Object.entries(item));
			expect(typeof registeredAt).toBe("string");
			expect(passwordUpdatedAt).toBe(registeredAt);
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

	describe("createUserWithPasswordHash", () => {
		it("records the password as changed at the instant the account was registered", async () => {
			const { client, commands } = createWriteFakeClient();

			await initAuth(client).createUserWithPasswordHash({
				email: "user@example.com",
				passwordHash: "hashed",
				attribution: undefined,
			});

			const item = commands.find((c) => c.name === "PutCommand")?.input.Item;
			assert(item && typeof item === "object", "expected a PutCommand item");
			const { registeredAt, passwordUpdatedAt } = Object.fromEntries(Object.entries(item));
			expect(typeof registeredAt).toBe("string");
			expect(passwordUpdatedAt).toBe(registeredAt);
		});
	});

	describe("createAppleUser", () => {
		it("stores the Apple refresh token on the verified user row", async () => {
			const { client, commands } = createWriteFakeClient();

			const result = await initAuth(client).createAppleUser({
				email: "User@Example.com",
				userId: USER,
				appleRefreshToken: "apple-refresh-1",
			});

			assert(result.ok, "create should succeed");
			const put = commands.find((c) => c.name === "PutCommand");
			expect(put?.input).toMatchObject({
				Item: {
					email: "user@example.com",
					userId: USER,
					emailVerified: true,
					appleRefreshToken: "apple-refresh-1",
				},
			});
		});

		it("keeps Google rows free of the appleRefreshToken attribute", async () => {
			const { client, commands } = createWriteFakeClient();

			const result = await initAuth(client).createGoogleUser({
				email: "user@example.com",
				userId: USER,
			});

			assert(result.ok, "create should succeed");
			const put = commands.find((c) => c.name === "PutCommand");
			assert(put, "expected a PutCommand");
			expect(put.input.Item).not.toHaveProperty("appleRefreshToken");
		});

		it("writes a federated row with no password and so no record of a password change", async () => {
			const { client, commands } = createWriteFakeClient();

			await initAuth(client).createGoogleUser({ email: "user@example.com", userId: USER });

			const put = commands.find((c) => c.name === "PutCommand");
			assert(put, "expected a PutCommand");
			expect(put.input.Item).toEqual({
				email: "user@example.com",
				userId: USER,
				emailVerified: true,
				registeredAt: expect.any(String),
				canonicalEmail: "user@example.com",
			});
		});
	});

	describe("saveAppleRefreshToken", () => {
		it("updates the normalized row conditionally so a deleted account cannot be resurrected", async () => {
			const { client, commands } = createWriteFakeClient();

			await initAuth(client).saveAppleRefreshToken({
				email: "User@Example.com",
				appleRefreshToken: "apple-refresh-2",
			});

			const update = commands.find((c) => c.name === "UpdateCommand");
			expect(update?.input).toMatchObject({
				Key: { email: "user@example.com" },
				UpdateExpression: "SET appleRefreshToken = :token",
				ConditionExpression: "attribute_exists(email)",
				ExpressionAttributeValues: { ":token": "apple-refresh-2" },
			});
		});
	});

	describe("findAppleRefreshTokenByUserId", () => {
		it("returns the stored token via the userId-index", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { email: "u@example.com", userId: "abc123", appleRefreshToken: "apple-refresh-3" },
			});

			const token = await initAuth(client).findAppleRefreshTokenByUserId(USER);

			expect(token).toBe("apple-refresh-3");
			const query = commands.find((c) => c.name === "QueryCommand");
			expect(query?.input).toMatchObject({ IndexName: "userId-index" });
		});

		it("returns null when the user row has no stored token", async () => {
			const { client } = createQueryFakeClient({
				row: { email: "u@example.com", userId: "abc123" },
			});

			expect(await initAuth(client).findAppleRefreshTokenByUserId(USER)).toBe(null);
		});

		it("returns null when no row exists for the id", async () => {
			const { client } = createQueryFakeClient({});

			expect(await initAuth(client).findAppleRefreshTokenByUserId(USER)).toBe(null);
		});
	});

	describe("destroyUserSessions", () => {
		it("queries the sessions userId-index and deletes each session by id", async () => {
			const { client, commands } = createQueryFakeClient({
				row: { sessionId: "sess-1", userId: "abc123", expiresAt: 9999999999, emailVerified: true },
			});

			await initAuth(client).destroyUserSessions(USER);

			const query = commands.find((c) => c.name === "QueryCommand");
			expect(query?.input).toMatchObject({
				IndexName: "userId-index",
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": "abc123" },
			});
			const del = commands.find((c) => c.name === "DeleteCommand");
			expect(del?.input).toMatchObject({ Key: { sessionId: "sess-1" } });
		});

		it("deletes nothing when the user has no sessions", async () => {
			const { client, commands } = createQueryFakeClient({});

			await initAuth(client).destroyUserSessions(USER);

			expect(commands.some((c) => c.name === "DeleteCommand")).toBe(false);
		});

		it("paginates the userId-index, feeding each page's key back as ExclusiveStartKey", async () => {
			const { client, commands } = createPaginatedQueryFakeClient([
				{
					rows: [{ sessionId: "sess-1", userId: "abc123", expiresAt: 9999999999, emailVerified: true }],
					lastEvaluatedKey: { sessionId: "sess-1" },
				},
				{ rows: [{ sessionId: "sess-2", userId: "abc123", expiresAt: 9999999999, emailVerified: true }] },
			]);

			await initAuth(client).destroyUserSessions(USER);

			const queries = commands.filter((c) => c.name === "QueryCommand");
			expect(queries).toHaveLength(2);
			expect(queries[0]?.input.ExclusiveStartKey).toBeUndefined();
			expect(queries[1]?.input.ExclusiveStartKey).toEqual({ sessionId: "sess-1" });
			const deleted = commands.filter((c) => c.name === "DeleteCommand").map((c) => c.input.Key);
			expect(deleted).toEqual([{ sessionId: "sess-1" }, { sessionId: "sess-2" }]);
		});
	});

	describe("destroyOAuthGrantSessions", () => {
		const GRANT = OAuthGrantIdSchema.parse("grant-a");
		const sessionRow = (sessionId: string) => ({ sessionId, userId: "abc123", expiresAt: 9999999999, emailVerified: true, oauthGrantId: "grant-a" });
		const conditionFailed = () => new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" });

		it("queries the sessions userId-index the same way destroyUserSessions does", async () => {
			const grantScoped = createQueryFakeClient({ row: sessionRow("sess-1") });
			const userWide = createQueryFakeClient({ row: sessionRow("sess-1") });

			await initAuth(grantScoped.client).destroyOAuthGrantSessions({ userId: USER, oauthGrantId: GRANT });
			await initAuth(userWide.client).destroyUserSessions(USER);

			const grantScopedQuery = grantScoped.commands.find((c) => c.name === "QueryCommand");
			const userWideQuery = userWide.commands.find((c) => c.name === "QueryCommand");
			assert(grantScopedQuery, "the grant-scoped delete must query the index");
			expect(grantScopedQuery.input).toEqual(userWideQuery?.input);
		});

		it("deletes each session only on the condition that it carries the grant, returning the deleted row", async () => {
			const { client, commands } = createPaginatedQueryFakeClient([{ rows: [sessionRow("sess-1"), sessionRow("sess-2")] }]);

			await initAuth(client).destroyOAuthGrantSessions({ userId: USER, oauthGrantId: GRANT });

			const deletes = commands.filter((c) => c.name === "DeleteCommand").map((c) => c.input);
			expect(deletes).toEqual([
				{ TableName: "sessions", Key: { sessionId: "sess-1" }, ConditionExpression: "oauthGrantId = :grant", ExpressionAttributeValues: { ":grant": "grant-a" }, ReturnValues: "ALL_OLD" },
				{ TableName: "sessions", Key: { sessionId: "sess-2" }, ConditionExpression: "oauthGrantId = :grant", ExpressionAttributeValues: { ":grant": "grant-a" }, ReturnValues: "ALL_OLD" },
			]);
		});

		it("keeps a session the condition refuses, still deletes the others, and observes only the deleted ones", async () => {
			const { client, commands } = createPaginatedQueryFakeClient(
				[{ rows: [sessionRow("sess-web"), sessionRow("sess-app")] }],
				{
					onDelete: async (input) => {
						const key = z.object({ Key: z.object({ sessionId: z.string() }) }).parse(input).Key;
						if (key.sessionId === "sess-web") throw conditionFailed();
						return { Attributes: sessionRow(key.sessionId) };
					},
				},
			);
			const observations: unknown[] = [];
			const auth = initDynamoDbAuth({ client, usersTableName: "users", sessionsTableName: "sessions", observeSession: (event) => { observations.push(event); } });

			await auth.destroyOAuthGrantSessions({ userId: USER, oauthGrantId: GRANT });

			expect(commands.filter((c) => c.name === "DeleteCommand").map((c) => c.input.Key)).toEqual([{ sessionId: "sess-web" }, { sessionId: "sess-app" }]);
			expect(observations).toEqual([{ event: "session_deleted", sessionId: "sess-app", userId: "abc123", expiresAt: 9999999999 }]);
		});

		it("rejects when a delete fails for any reason other than the grant condition", async () => {
			const { client } = createPaginatedQueryFakeClient(
				[{ rows: [sessionRow("sess-1")] }],
				{ onDelete: async () => { throw new Error("throughput exceeded"); } },
			);

			await expect(initAuth(client).destroyOAuthGrantSessions({ userId: USER, oauthGrantId: GRANT })).rejects.toThrow("throughput exceeded");
		});

		it("paginates the userId-index, feeding each page's key back as ExclusiveStartKey", async () => {
			const { client, commands } = createPaginatedQueryFakeClient([
				{ rows: [sessionRow("sess-1")], lastEvaluatedKey: { sessionId: "sess-1" } },
				{ rows: [sessionRow("sess-2")] },
			]);

			await initAuth(client).destroyOAuthGrantSessions({ userId: USER, oauthGrantId: GRANT });

			const queries = commands.filter((c) => c.name === "QueryCommand");
			expect(queries).toHaveLength(2);
			expect(queries[0]?.input.ExclusiveStartKey).toBeUndefined();
			expect(queries[1]?.input.ExclusiveStartKey).toEqual({ sessionId: "sess-1" });
			expect(commands.filter((c) => c.name === "DeleteCommand").map((c) => c.input.Key)).toEqual([{ sessionId: "sess-1" }, { sessionId: "sess-2" }]);
		});

		it("deletes nothing when the user has no sessions", async () => {
			const { client, commands } = createQueryFakeClient({});

			await initAuth(client).destroyOAuthGrantSessions({ userId: USER, oauthGrantId: GRANT });

			expect(commands.filter((c) => c.name === "DeleteCommand")).toEqual([]);
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

	describe("createSession", () => {
		it("remembers the grant that minted the session when the bearer carries one", async () => {
			const { client, commands } = createWriteFakeClient();

			const sessionId = await initAuth(client).createSession({ userId: USER, emailVerified: true, oauthGrantId: OAuthGrantIdSchema.parse("grant-1") });

			const put = commands.find((command) => command.name === "PutCommand");
			assert(put, "createSession issues a PutCommand");
			expect(put.input.Item).toStrictEqual({ sessionId, userId: "abc123", emailVerified: true, expiresAt: expect.any(Number), oauthGrantId: "grant-1" });
		});

		it("writes no grant attribute for a session minted by a login", async () => {
			const { client, commands } = createWriteFakeClient();

			const sessionId = await initAuth(client).createSession({ userId: USER, emailVerified: true });

			const put = commands.find((command) => command.name === "PutCommand");
			assert(put, "createSession issues a PutCommand");
			expect(put.input.Item).toStrictEqual({ sessionId, userId: "abc123", emailVerified: true, expiresAt: expect.any(Number) });
		});
	});

	describe("renewSession", () => {
		it("attributes renewal and deletion to the previous session row", async () => {
			const observations: unknown[] = [];
			const userId = UserIdSchema.parse("session-owner");
			const previous = { sessionId: "sid", userId, expiresAt: 123, emailVerified: true };
			const commands: CapturedCommand[] = [];
			const client = { send: (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
				commands.push({ name: command.constructor.name, input: command.input });
				return { Attributes: previous };
			}) as DynamoDBDocumentClient["send"] } as DynamoDBDocumentClient;
			const auth = initDynamoDbAuth({ client, usersTableName: "users", sessionsTableName: "sessions", observeSession: event => { observations.push(event); } });
			await auth.renewSession({ sessionId: "sid" });
			await auth.destroySession("sid");
			expect(commands.map(command => command.input.ReturnValues)).toEqual(["ALL_OLD", "ALL_OLD"]);
			expect(observations).toEqual([
				{ event: "session_renewed", sessionId: "sid", userId, previousExpiresAt: 123, expiresAt: expect.any(Number) },
				{ event: "session_deleted", sessionId: "sid", userId, expiresAt: 123 },
			]);
		});
		it("renews conditionally so a deleted or expired row is never resurrected", async () => {
			const { client, commands } = createWriteFakeClient();
			const auth = initAuth(client);

			const outcome = await auth.renewSession({ sessionId: "sid" });

			expect(outcome).toBe("renewed");
			const update = commands.find((command) => command.name === "UpdateCommand");
			assert(update, "renewSession issues an UpdateCommand");
			expect(update.input).toMatchObject({
				Key: { sessionId: "sid" },
				UpdateExpression: "SET expiresAt = :expiresAt",
				ConditionExpression: "attribute_exists(sessionId) AND expiresAt >= :now",
			});
			expect(update.input.ExpressionAttributeValues).toStrictEqual({ ":expiresAt": expect.any(Number), ":now": expect.any(Number) });
			const values = z.object({ ":expiresAt": z.number(), ":now": z.number() }).parse(update.input.ExpressionAttributeValues);
			expect(values[":expiresAt"] - values[":now"]).toBe(180 * 24 * 60 * 60);
		});

		it("rebinds the session to the grant that renewed it when the bearer carries one", async () => {
			const { client, commands } = createWriteFakeClient();
			const auth = initAuth(client);

			const outcome = await auth.renewSession({ sessionId: "sid", oauthGrantId: OAuthGrantIdSchema.parse("grant-1") });

			expect(outcome).toBe("renewed");
			const update = commands.find((command) => command.name === "UpdateCommand");
			assert(update, "renewSession issues an UpdateCommand");
			expect(update.input).toMatchObject({
				Key: { sessionId: "sid" },
				UpdateExpression: "SET expiresAt = :expiresAt, oauthGrantId = :grant",
				ConditionExpression: "attribute_exists(sessionId) AND expiresAt >= :now",
				ExpressionAttributeValues: { ":grant": "grant-1" },
			});
		});

		it("reports session-gone when the row is missing or already expired", async () => {
			const { client } = createWriteFakeClient({
				fail: new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" }),
			});
			const auth = initAuth(client);

			expect(await auth.renewSession({ sessionId: "sid" })).toBe("session-gone");
		});

		it("rethrows any other write failure rather than reporting session-gone", async () => {
			const { client } = createWriteFakeClient({ fail: new Error("dynamo unavailable") });
			const auth = initAuth(client);

			await expect(auth.renewSession({ sessionId: "sid" })).rejects.toThrow("dynamo unavailable");
		});
	});

	describe("setSessionReadlistFilter", () => {
		it("stores the chips on the session row, only while the row exists", async () => {
			const { client, commands } = createWriteFakeClient();
			const auth = initAuth(client);

			await auth.setSessionReadlistFilter({ sessionId: "sid", filter: { time: ["5-10"], saved: ["week"] } });

			expect(commands).toEqual([
				{
					name: "UpdateCommand",
					input: expect.objectContaining({
						Key: { sessionId: "sid" },
						UpdateExpression: "SET readlistFilter = :filter",
						ConditionExpression: "attribute_exists(sessionId)",
						ExpressionAttributeValues: { ":filter": { time: ["5-10"], saved: ["week"] } },
					}),
				},
			]);
		});

		it("removes the attribute when no chip is ticked", async () => {
			const { client, commands } = createWriteFakeClient();
			const auth = initAuth(client);

			await auth.setSessionReadlistFilter({ sessionId: "sid", filter: { time: [], saved: [] } });

			expect(commands[0]?.input).toMatchObject({
				UpdateExpression: "REMOVE readlistFilter",
				ConditionExpression: "attribute_exists(sessionId)",
			});
		});

		it("does nothing when the session was already destroyed", async () => {
			const { client } = createWriteFakeClient({
				fail: new ConditionalCheckFailedException({ $metadata: {}, message: "condition failed" }),
			});
			const auth = initAuth(client);

			await auth.setSessionReadlistFilter({ sessionId: "sid", filter: { time: ["5-10"], saved: [] } });
		});

		it("rethrows any other write failure", async () => {
			const { client } = createWriteFakeClient({ fail: new Error("dynamo unavailable") });
			const auth = initAuth(client);

			await expect(
				auth.setSessionReadlistFilter({ sessionId: "sid", filter: { time: ["5-10"], saved: [] } }),
			).rejects.toThrow("dynamo unavailable");
		});
	});

	function sessionRowClient(item: Record<string, unknown> | undefined): DynamoDBDocumentClient {
		const client = {
			send: (async () => ({ Item: item })) as DynamoDBDocumentClient["send"],
		};
		return client as typeof client & DynamoDBDocumentClient;
	}

	describe("findSessionReadlistFilter", () => {
		it("reads the chips stored on the session row", async () => {
			const auth = initAuth(
				sessionRowClient({
					sessionId: "sid",
					userId: "abc123",
					expiresAt: 1,
					readlistFilter: { time: ["5-10"], saved: [] },
				}),
			);

			expect(await auth.findSessionReadlistFilter("sid")).toEqual({ time: ["5-10"], saved: [] });
		});

		it("reads no filter from a session row that holds none", async () => {
			const auth = initAuth(sessionRowClient({ sessionId: "sid", userId: "abc123", expiresAt: 1 }));

			expect(await auth.findSessionReadlistFilter("sid")).toBe(undefined);
		});

		it("reads no filter for a missing session", async () => {
			const auth = initAuth(sessionRowClient(undefined));

			expect(await auth.findSessionReadlistFilter("sid")).toBe(undefined);
		});
	});

	describe("findSessionOAuthGrant", () => {
		it("reads the grant the session row remembers", async () => {
			const auth = initAuth(sessionRowClient({ sessionId: "sid", userId: "abc123", expiresAt: 1, oauthGrantId: "grant-1" }));

			expect(await auth.findSessionOAuthGrant("sid")).toBe("grant-1");
		});

		it("reads no grant from a session row that holds none", async () => {
			const auth = initAuth(sessionRowClient({ sessionId: "sid", userId: "abc123", expiresAt: 1 }));

			expect(await auth.findSessionOAuthGrant("sid")).toBe(undefined);
		});

		it("reads no grant for a missing session", async () => {
			const auth = initAuth(sessionRowClient(undefined));

			expect(await auth.findSessionOAuthGrant("sid")).toBe(undefined);
		});
	});
});
