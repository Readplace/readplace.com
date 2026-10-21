/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
	defineDynamoTable,
	dynamoField,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	UserIdSchema,
	AppearancePreferenceSchema,
	DisplayNameSchema,
	normalizeEmail,
	canonicalizeEmail,
	gmailIdentityKey,
	hashPassword,
	verifyPassword,
	type UserId,
	type CanonicalEmail,
} from "@packages/domain/user";
import { SESSION_TTL_SECONDS, SessionRow, initGetSessionUserId } from "@packages/web-session";
import type {
	CloseUserAccount,
	CountUsers,
	CreateAppleUser,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroyOAuthGrantSessions,
	DestroySession,
	DestroyUserSessions,
	FindAppleRefreshTokenByUserId,
	FindEmailByUserId,
	FindSessionOAuthGrant,
	FindSessionReadlistFilter,
	FindUserById,
	FindUserByEmail,
	FindUserContactByUserId,
	FindUserPasswordStatus,
	GetSessionUserId,
	MarkAccountDeleted,
	MarkEmailVerified,
	RenewSession,
	MarkSessionEmailVerified,
	ObserveSession,
	SaveAppleRefreshToken,
	SetQueueDigestOptOut,
	SetSessionReadlistFilter,
	SetUserAppearance,
	SetUserDisplayName,
	UpdatePassword,
	UserAcquisitionAttribution,
	UserExistsByEmail,
	VerifyCredentials,
} from "@packages/provider-contracts/auth";

const UserRow = z.object({
	email: z.string(),
	userId: UserIdSchema,
	passwordHash: dynamoField(z.string()),
	passwordUpdatedAt: dynamoField(z.string()),
	/* Only on rows that signed in with Apple; revoked and deleted with the
	 * account (App Store 5.1.1(v)). */
	appleRefreshToken: dynamoField(z.string()),
	emailVerified: dynamoField(z.boolean()),
	/* Optional in the schema so reads of pre-backfill rows don't throw; new writes always set it. */
	registeredAt: dynamoField(z.string()),
	/* Optional so reads of pre-backfill rows don't throw; new writes always set it. */
	canonicalEmail: dynamoField(z.string()),
	/* Acquisition attribution captured from the hutch_click cookie at signup.
	 * All optional via dynamoField: organic landings carry only first_seen_at /
	 * landing_path, and legacy rows predate the columns entirely. */
	utm_source: dynamoField(z.string()),
	utm_medium: dynamoField(z.string()),
	utm_campaign: dynamoField(z.string()),
	utm_content: dynamoField(z.string()),
	referrer_host: dynamoField(z.string()),
	first_seen_at: dynamoField(z.string()),
	landing_path: dynamoField(z.string()),
	deletedAt: dynamoField(z.string()),
	appearance: dynamoField(AppearancePreferenceSchema),
	displayName: dynamoField(DisplayNameSchema),
	queueDigestOptOutAt: dynamoField(z.string()),
});

/* Gmail uniqueness claims live in the users table under this PK prefix. Zod
 * rejects "#" in emails, so a claim PK can never collide with a delivery-email
 * PK. Claim items carry ownerUserId (never userId), keeping them out of the
 * GSI and out of countUsers' attribute_exists(userId) filter. */
const CLAIM_PK_PREFIX = "canonical#";

function liveUserRow<T extends { deletedAt?: string }>(row: T | undefined): T | undefined {
	return row && !row.deletedAt ? row : undefined;
}

export function initDynamoDbAuth(deps: {
	client: DynamoDBDocumentClient;
	usersTableName: string;
	sessionsTableName: string;
	observeSession: ObserveSession;
}): {
	createUser: CreateUser;
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	createGoogleUser: CreateGoogleUser;
	createAppleUser: CreateAppleUser;
	saveAppleRefreshToken: SaveAppleRefreshToken;
	findAppleRefreshTokenByUserId: FindAppleRefreshTokenByUserId;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	renewSession: RenewSession;
	destroySession: DestroySession;
	destroyUserSessions: DestroyUserSessions;
	destroyOAuthGrantSessions: DestroyOAuthGrantSessions;
	closeUserAccount: CloseUserAccount;
	markAccountDeleted: MarkAccountDeleted;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	setSessionReadlistFilter: SetSessionReadlistFilter;
	findSessionReadlistFilter: FindSessionReadlistFilter;
	findSessionOAuthGrant: FindSessionOAuthGrant;
	userExistsByEmail: UserExistsByEmail;
	updatePassword: UpdatePassword;
	findEmailByUserId: FindEmailByUserId;
	findUserContactByUserId: FindUserContactByUserId;
	findUserById: FindUserById;
	findUserPasswordStatus: FindUserPasswordStatus;
	setUserAppearance: SetUserAppearance;
	setUserDisplayName: SetUserDisplayName;
	setQueueDigestOptOut: SetQueueDigestOptOut;
} {
	const users = defineDynamoTable({
		client: deps.client,
		tableName: deps.usersTableName,
		schema: UserRow,
	});
	const sessions = defineDynamoTable({
		client: deps.client,
		tableName: deps.sessionsTableName,
		schema: SessionRow,
	});
	/* Matches the KEYS_ONLY projection of the sessions userId-index. */
	const sessionKeysByUser = defineDynamoTable({
		client: deps.client,
		tableName: deps.sessionsTableName,
		schema: z.object({ sessionId: z.string() }),
	});
	/** Persists a new user row, guarded by attribute_not_exists(email). For Gmail
	 * mailboxes it also writes the canonical claim item in the same transaction so
	 * the two-key uniqueness commit is atomic; a lost race on either key cancels
	 * the whole write and surfaces as email-already-exists. */
	const writeNewUserRow = async (params: {
		userRow: Record<string, unknown>;
		userId: UserId;
		gmailClaimKey: CanonicalEmail | null;
	}): Promise<{ ok: true } | { ok: false; reason: "email-already-exists" }> => {
		const { userRow, userId, gmailClaimKey } = params;
		try {
			if (gmailClaimKey === null) {
				await users.put({
					Item: userRow,
					ConditionExpression: "attribute_not_exists(email)",
				});
			} else {
				await deps.client.send(
					new TransactWriteCommand({
						TransactItems: [
							{
								Put: {
									TableName: deps.usersTableName,
									Item: userRow,
									ConditionExpression: "attribute_not_exists(email)",
								},
							},
							{
								Put: {
									TableName: deps.usersTableName,
									Item: { email: `${CLAIM_PK_PREFIX}${gmailClaimKey}`, ownerUserId: userId },
									ConditionExpression: "attribute_not_exists(email)",
								},
							},
						],
					}),
				);
			}
			return { ok: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "email-already-exists" };
			}
			if (error instanceof TransactionCanceledException) {
				// Both puts in the Gmail two-key commit are conditioned on
				// attribute_not_exists, so a lost race on either the delivery email or
				// the canonical claim cancels with ConditionalCheckFailed. Any other
				// cancellation (throttling, conflict, validation) is a distinct,
				// often-retryable failure that must propagate, not read as a duplicate.
				const reasons = error.CancellationReasons;
				const rowRejected = reasons?.[0]?.Code === "ConditionalCheckFailed";
				const claimRejected = reasons?.[1]?.Code === "ConditionalCheckFailed";
				if (rowRejected || claimRejected) {
					return { ok: false, reason: "email-already-exists" };
				}
			}
			throw error;
		}
	};

	const createUser: CreateUser = async ({ email, password, attribution }) => {
		const normalizedEmail = normalizeEmail(email);
		assert(!normalizedEmail.startsWith(CLAIM_PK_PREFIX), `Email collides with the claim namespace: ${email}`);
		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const passwordHash = await hashPassword(password);
		const at = new Date().toISOString();

		const result = await writeNewUserRow({
			userRow: {
				email: normalizedEmail,
				userId,
				passwordHash,
				passwordUpdatedAt: at,
				emailVerified: false,
				registeredAt: at,
				canonicalEmail: canonicalizeEmail(email),
				...(attribution ?? {}),
			},
			userId,
			gmailClaimKey: gmailIdentityKey(email),
		});
		return result.ok ? { ok: true, userId } : result;
	};

	const createUserWithPasswordHash: CreateUserWithPasswordHash = async ({ email, passwordHash, attribution }) => {
		const normalizedEmail = normalizeEmail(email);
		assert(!normalizedEmail.startsWith(CLAIM_PK_PREFIX), `Email collides with the claim namespace: ${email}`);
		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const at = new Date().toISOString();

		const result = await writeNewUserRow({
			userRow: {
				email: normalizedEmail,
				userId,
				passwordHash,
				passwordUpdatedAt: at,
				emailVerified: false,
				registeredAt: at,
				canonicalEmail: canonicalizeEmail(email),
				...(attribution ?? {}),
			},
			userId,
			gmailClaimKey: gmailIdentityKey(email),
		});
		return result.ok ? { ok: true, userId } : result;
	};

	/** A user created from a federated identity provider (Google/Apple): verified
	 * email, no password hash. The provider's `sub` is deliberately never stored,
	 * users are keyed by normalized email. The Gmail canonical claim still applies,
	 * so an Apple ID backed by a Gmail address contends for the same uniqueness
	 * claim. Apple rows additionally carry the refresh token that account deletion
	 * revokes; Google persists no token. */
	const createFederatedUser = async ({
		email,
		userId,
		attribution,
		appleRefreshToken,
	}: {
		email: string;
		userId: UserId;
		attribution?: UserAcquisitionAttribution;
		appleRefreshToken?: string;
	}) => {
		const normalizedEmail = normalizeEmail(email);
		assert(!normalizedEmail.startsWith(CLAIM_PK_PREFIX), `Email collides with the claim namespace: ${email}`);

		const result = await writeNewUserRow({
			userRow: {
				email: normalizedEmail,
				userId,
				emailVerified: true,
				registeredAt: new Date().toISOString(),
				canonicalEmail: canonicalizeEmail(email),
				...(appleRefreshToken === undefined ? {} : { appleRefreshToken }),
				...(attribution ?? {}),
			},
			userId,
			gmailClaimKey: gmailIdentityKey(email),
		});
		return result.ok ? { ok: true as const, userId } : result;
	};
	const createGoogleUser: CreateGoogleUser = createFederatedUser;
	const createAppleUser: CreateAppleUser = createFederatedUser;

	const saveAppleRefreshToken: SaveAppleRefreshToken = async ({ email, appleRefreshToken }) => {
		const normalizedEmail = normalizeEmail(email);
		await users.update({
			Key: { email: normalizedEmail },
			UpdateExpression: "SET appleRefreshToken = :token",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":token": appleRefreshToken },
		});
	};

	const findAppleRefreshTokenByUserId: FindAppleRefreshTokenByUserId = async (userId) => {
		const { items } = await users.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			Limit: 1,
		});
		const row = items[0];
		return row?.appleRefreshToken ?? null;
	};

	const findUserByEmail: FindUserByEmail = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		const row = liveUserRow(
			await users.get(
				{ email: normalizedEmail },
				{ projection: ["email", "userId", "emailVerified", "registeredAt", "deletedAt"] },
			),
		);
		if (!row) return null;
		return {
			userId: row.userId,
			emailVerified: row.emailVerified === true,
			registeredAt: row.registeredAt,
		};
	};

	const verifyCredentials: VerifyCredentials = async ({ email, password }) => {
		const normalizedEmail = normalizeEmail(email);
		const row = liveUserRow(await users.get({ email: normalizedEmail }));
		if (!row) return { ok: false, reason: "invalid-credentials" };

		const valid = await verifyPassword(password, row.passwordHash);
		if (!valid) return { ok: false, reason: "invalid-credentials" };

		return { ok: true, userId: row.userId, emailVerified: row.emailVerified === true };
	};

	const createSession: CreateSession = async ({ userId, emailVerified, oauthGrantId }) => {
		const sessionId = randomBytes(32).toString("hex");
		const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

		await sessions.put({
			Item: { sessionId, userId, emailVerified, expiresAt, ...(oauthGrantId === undefined ? {} : { oauthGrantId }) },
		});
		deps.observeSession({ event: "session_created", sessionId, userId, expiresAt });

		return sessionId;
	};

	const renewSession: RenewSession = async ({ sessionId, oauthGrantId }) => {
		const now = Math.floor(Date.now() / 1000);
		try {
			const previous = await sessions.update({
				Key: { sessionId },
				UpdateExpression: oauthGrantId === undefined ? "SET expiresAt = :expiresAt" : "SET expiresAt = :expiresAt, oauthGrantId = :grant",
				ReturnValues: "ALL_OLD",
				ConditionExpression: "attribute_exists(sessionId) AND expiresAt >= :now",
				ExpressionAttributeValues: { ":expiresAt": now + SESSION_TTL_SECONDS, ":now": now, ...(oauthGrantId === undefined ? {} : { ":grant": oauthGrantId }) },
			});
			deps.observeSession({ event: "session_renewed", sessionId, userId: previous.Attributes?.userId, previousExpiresAt: previous.Attributes?.expiresAt, expiresAt: now + SESSION_TTL_SECONDS });
			return "renewed";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "session-gone";
			throw error;
		}
	};

	const getSessionUserId: GetSessionUserId = initGetSessionUserId({
		client: deps.client,
		sessionsTableName: deps.sessionsTableName,
		observeSession: deps.observeSession,
	});

	const destroySession: DestroySession = async (sessionId) => {
		const previous = await sessions.delete({ Key: { sessionId }, ReturnValues: "ALL_OLD" });
		deps.observeSession({ event: "session_deleted", sessionId, userId: previous.Attributes?.userId, expiresAt: previous.Attributes?.expiresAt });
	};

	const destroyUserSessions: DestroyUserSessions = async (userId) => {
		await forEachQueryPage(
			sessionKeysByUser,
			{
				IndexName: "userId-index",
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": userId },
			},
			async (rows) => {
				await Promise.all(rows.map((row) => destroySession(row.sessionId)));
			},
		);
	};

	const destroyOAuthGrantSessions: DestroyOAuthGrantSessions = async ({ userId, oauthGrantId }) => {
		await forEachQueryPage(
			sessionKeysByUser,
			{
				IndexName: "userId-index",
				KeyConditionExpression: "userId = :userId",
				ExpressionAttributeValues: { ":userId": userId },
			},
			async (rows) => {
				await Promise.all(rows.map(async (row) => {
					try {
						const previous = await sessions.delete({
							Key: { sessionId: row.sessionId },
							ConditionExpression: "oauthGrantId = :grant",
							ExpressionAttributeValues: { ":grant": oauthGrantId },
							ReturnValues: "ALL_OLD",
						});
						deps.observeSession({ event: "session_deleted", sessionId: row.sessionId, userId: previous.Attributes?.userId, expiresAt: previous.Attributes?.expiresAt });
					} catch (error) {
						if (error instanceof ConditionalCheckFailedException) return;
						throw error;
					}
				}));
			},
		);
	};

	const countUsers: CountUsers = async () => {
		// Claim items share the table but carry ownerUserId, not userId, so this
		// filter counts only real user rows (the founding-member gate reads this).
		let total = 0;
		let startKey: Record<string, unknown> | undefined;
		do {
			const { count, lastEvaluatedKey } = await users.scan({
				Select: "COUNT",
				FilterExpression: "attribute_exists(userId)",
				ExclusiveStartKey: startKey,
			});
			total += count;
			startKey = lastEvaluatedKey;
		} while (startKey);
		return total;
	};

	const markEmailVerified: MarkEmailVerified = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		await users.update({
			Key: { email: normalizedEmail },
			UpdateExpression: "SET emailVerified = :val",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":val": true },
		});
	};

	const markSessionEmailVerified: MarkSessionEmailVerified = async (sessionId) => {
		await sessions.update({
			Key: { sessionId },
			UpdateExpression: "SET emailVerified = :val",
			ExpressionAttributeValues: { ":val": true },
		});
	};

	const setSessionReadlistFilter: SetSessionReadlistFilter = async ({ sessionId, filter }) => {
		const empty = filter.time.length === 0 && filter.saved.length === 0;
		try {
			await sessions.update({
				Key: { sessionId },
				UpdateExpression: empty ? "REMOVE readlistFilter" : "SET readlistFilter = :filter",
				ConditionExpression: "attribute_exists(sessionId)",
				...(empty ? {} : { ExpressionAttributeValues: { ":filter": filter } }),
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	const findSessionReadlistFilter: FindSessionReadlistFilter = async (sessionId) => {
		const row = await sessions.get({ sessionId });
		return row?.readlistFilter;
	};

	const findSessionOAuthGrant: FindSessionOAuthGrant = async (sessionId) => {
		const row = await sessions.get({ sessionId });
		return row?.oauthGrantId;
	};

	const userExistsByEmail: UserExistsByEmail = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		const { count } = await users.query({
			KeyConditionExpression: "email = :email",
			ExpressionAttributeValues: { ":email": normalizedEmail },
			Select: "COUNT",
		});
		return count > 0;
	};

	const findEmailByUserId: FindEmailByUserId = async (userId) => {
		const { items } = await users.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			Limit: 1,
		});
		const row = items[0];
		return row ? row.email : null;
	};

	const closeUserAccount: CloseUserAccount = async (userId) => {
		const email = await findEmailByUserId(userId);
		if (email === null) return;
		const claimKey = gmailIdentityKey(email);
		if (claimKey === null) {
			await users.delete({ Key: { email } });
			return;
		}
		await deps.client.send(
			new TransactWriteCommand({
				TransactItems: [
					{ Delete: { TableName: deps.usersTableName, Key: { email } } },
					{
						Delete: {
							TableName: deps.usersTableName,
							Key: { email: `${CLAIM_PK_PREFIX}${claimKey}` },
						},
					},
				],
			}),
		);
	};

	const markAccountDeleted: MarkAccountDeleted = async ({ userId, at }) => {
		const email = await findEmailByUserId(userId);
		if (email === null) return;
		await users.update({
			Key: { email },
			UpdateExpression: "SET deletedAt = if_not_exists(deletedAt, :at)",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":at": at },
		});
	};

	const findUserContactByUserId: FindUserContactByUserId = async (userId) => {
		const { items } = await users.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			Limit: 1,
		});
		const row = items[0];
		if (!row) return null;
		return {
			email: row.email,
			emailVerified: row.emailVerified === true,
			queueDigestOptOutAt: row.queueDigestOptOutAt,
			deletedAt: row.deletedAt,
		};
	};

	const findUserById: FindUserById = async (userId) => {
		const { items } = await users.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			Limit: 1,
		});
		const row = items[0];
		if (!row) return null;
		return {
			userId: row.userId,
			email: row.email,
			emailVerified: row.emailVerified === true,
			registeredAt: row.registeredAt,
			appearance: row.appearance,
			displayName: row.displayName,
			deletedAt: row.deletedAt,
		};
	};

	const findUserPasswordStatus: FindUserPasswordStatus = async (userId) => {
		const { items } = await users.query({
			IndexName: "userId-index",
			KeyConditionExpression: "userId = :userId",
			ExpressionAttributeValues: { ":userId": userId },
			Limit: 1,
		});
		const row = items[0];
		if (!row) return null;
		if (row.passwordHash === undefined) return { kind: "not-set" };
		return { kind: "set", updatedAt: row.passwordUpdatedAt };
	};

	const setUserAppearance: SetUserAppearance = async ({ userId, appearance }) => {
		const email = await findEmailByUserId(userId);
		if (email === null) return;
		await users.update({
			Key: { email },
			UpdateExpression: "SET appearance = :appearance",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":appearance": appearance },
		});
	};

	const setUserDisplayName: SetUserDisplayName = async ({ userId, displayName }) => {
		const email = await findEmailByUserId(userId);
		if (email === null) return;
		if (displayName === undefined) {
			await users.update({
				Key: { email },
				UpdateExpression: "REMOVE displayName",
				ConditionExpression: "attribute_exists(email)",
			});
			return;
		}
		await users.update({
			Key: { email },
			UpdateExpression: "SET displayName = :displayName",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":displayName": displayName },
		});
	};

	const setQueueDigestOptOut: SetQueueDigestOptOut = async ({ userId, optedOutAt }) => {
		const email = await findEmailByUserId(userId);
		if (email === null) return;
		if (optedOutAt === undefined) {
			await users.update({
				Key: { email },
				UpdateExpression: "REMOVE queueDigestOptOutAt",
				ConditionExpression: "attribute_exists(email)",
			});
			return;
		}
		await users.update({
			Key: { email },
			UpdateExpression: "SET queueDigestOptOutAt = :optedOutAt",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":optedOutAt": optedOutAt },
		});
	};

	const updatePassword: UpdatePassword = async ({ email, password, updatedAt }) => {
		const normalizedEmail = normalizeEmail(email);
		const passwordHash = await hashPassword(password);
		await users.update({
			Key: { email: normalizedEmail },
			UpdateExpression: "SET passwordHash = :hash, passwordUpdatedAt = :updatedAt",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":hash": passwordHash, ":updatedAt": updatedAt },
		});
	};

	return {
		createUser,
		createUserWithPasswordHash,
		createGoogleUser,
		createAppleUser,
		saveAppleRefreshToken,
		findAppleRefreshTokenByUserId,
		findUserByEmail,
		verifyCredentials,
		createSession,
		getSessionUserId,
		renewSession,
		destroySession,
		destroyUserSessions,
		destroyOAuthGrantSessions,
		closeUserAccount,
		markAccountDeleted,
		countUsers,
		markEmailVerified,
		markSessionEmailVerified,
		setSessionReadlistFilter,
		findSessionReadlistFilter,
		findSessionOAuthGrant,
		userExistsByEmail,
		updatePassword,
		findEmailByUserId,
		findUserContactByUserId,
		findUserById,
		findUserPasswordStatus,
		setUserAppearance,
		setUserDisplayName,
		setQueueDigestOptOut,
	};
}
/* c8 ignore stop */
