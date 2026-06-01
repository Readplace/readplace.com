/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomBytes } from "node:crypto";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema, userIdPrefixFrom } from "@packages/domain/user";
import type {
	CountUsers,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroySession,
	ExistsUserByIdPrefix,
	FindEmailByUserId,
	FindUserByEmail,
	GetSessionUserId,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	UpdatePassword,
	UserExistsByEmail,
	VerifyCredentials,
} from "@packages/test-fixtures/providers/auth";
import { normalizeEmail } from "@packages/test-fixtures/providers/auth";
import { hashPassword, verifyPassword } from "@packages/test-fixtures/providers/auth";

const UserRow = z.object({
	email: z.string(),
	userId: UserIdSchema,
	passwordHash: dynamoField(z.string()),
	emailVerified: dynamoField(z.boolean()),
	/* Optional in the schema so reads of pre-backfill rows don't throw; new writes always set it. */
	registeredAt: dynamoField(z.string()),
	/* Optional so reads of pre-backfill rows don't throw; new writes always set it. */
	userIdPrefix: dynamoField(z.string()),
});

const SessionRow = z.object({
	sessionId: z.string(),
	userId: UserIdSchema,
	expiresAt: z.number(),
	emailVerified: dynamoField(z.boolean()),
});

export function initDynamoDbAuth(deps: {
	client: DynamoDBDocumentClient;
	usersTableName: string;
	sessionsTableName: string;
}): {
	createUser: CreateUser;
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	createGoogleUser: CreateGoogleUser;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	destroySession: DestroySession;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	userExistsByEmail: UserExistsByEmail;
	existsUserByIdPrefix: ExistsUserByIdPrefix;
	updatePassword: UpdatePassword;
	findEmailByUserId: FindEmailByUserId;
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

	const createUser: CreateUser = async ({ email, password }) => {
		const normalizedEmail = normalizeEmail(email);
		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const passwordHash = await hashPassword(password);

		try {
			await users.put({
				Item: {
					email: normalizedEmail,
					userId,
					passwordHash,
					emailVerified: false,
					registeredAt: new Date().toISOString(),
					userIdPrefix: userIdPrefixFrom(userId),
				},
				ConditionExpression: "attribute_not_exists(email)",
			});
			return { ok: true, userId };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "email-already-exists" };
			}
			throw error;
		}
	};

	const createUserWithPasswordHash: CreateUserWithPasswordHash = async ({ email, passwordHash }) => {
		const normalizedEmail = normalizeEmail(email);
		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));

		try {
			await users.put({
				Item: {
					email: normalizedEmail,
					userId,
					passwordHash,
					emailVerified: false,
					registeredAt: new Date().toISOString(),
					userIdPrefix: userIdPrefixFrom(userId),
				},
				ConditionExpression: "attribute_not_exists(email)",
			});
			return { ok: true, userId };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "email-already-exists" };
			}
			throw error;
		}
	};

	const createGoogleUser: CreateGoogleUser = async ({ email, userId }) => {
		const normalizedEmail = normalizeEmail(email);

		try {
			await users.put({
				Item: {
					email: normalizedEmail,
					userId,
					emailVerified: true,
					registeredAt: new Date().toISOString(),
					userIdPrefix: userIdPrefixFrom(userId),
				},
				ConditionExpression: "attribute_not_exists(email)",
			});
			return { ok: true, userId };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "email-already-exists" };
			}
			throw error;
		}
	};

	const findUserByEmail: FindUserByEmail = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		const row = await users.get(
			{ email: normalizedEmail },
			{ projection: ["email", "userId", "emailVerified", "registeredAt"] },
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
		const row = await users.get({ email: normalizedEmail });
		if (!row) return { ok: false, reason: "invalid-credentials" };

		const valid = await verifyPassword(password, row.passwordHash);
		if (!valid) return { ok: false, reason: "invalid-credentials" };

		return { ok: true, userId: row.userId, emailVerified: row.emailVerified === true };
	};

	const createSession: CreateSession = async ({ userId, emailVerified }) => {
		const sessionId = randomBytes(32).toString("hex");
		const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days in seconds (TTL)

		await sessions.put({
			Item: { sessionId, userId, emailVerified, expiresAt },
		});

		return sessionId;
	};

	const getSessionUserId: GetSessionUserId = async (sessionId) => {
		const row = await sessions.get({ sessionId });
		if (!row) return null;
		if (row.expiresAt < Math.floor(Date.now() / 1000)) return null;
		return {
			userId: row.userId,
			emailVerified: row.emailVerified === true,
		};
	};

	const destroySession: DestroySession = async (sessionId) => {
		await sessions.delete({ Key: { sessionId } });
	};

	const countUsers: CountUsers = async () => {
		const { count } = await users.scan({ Select: "COUNT" });
		return count;
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

	const existsUserByIdPrefix: ExistsUserByIdPrefix = async (prefix) => {
		// Select: COUNT because the GSI is KEYS_ONLY: returned items would lack
		// `userId` and fail UserRow parsing in defineDynamoTable.query.
		const { count } = await users.query({
			IndexName: "userIdPrefix-index",
			KeyConditionExpression: "userIdPrefix = :prefix",
			ExpressionAttributeValues: { ":prefix": prefix },
			Select: "COUNT",
		});
		return count > 0;
	};

	const updatePassword: UpdatePassword = async ({ email, password }) => {
		const normalizedEmail = normalizeEmail(email);
		const passwordHash = await hashPassword(password);
		await users.update({
			Key: { email: normalizedEmail },
			UpdateExpression: "SET passwordHash = :hash",
			ConditionExpression: "attribute_exists(email)",
			ExpressionAttributeValues: { ":hash": passwordHash },
		});
	};

	return {
		createUser,
		createUserWithPasswordHash,
		createGoogleUser,
		findUserByEmail,
		verifyCredentials,
		createSession,
		getSessionUserId,
		destroySession,
		countUsers,
		markEmailVerified,
		markSessionEmailVerified,
		userExistsByEmail,
		existsUserByIdPrefix,
		updatePassword,
		findEmailByUserId,
	};
}
/* c8 ignore stop */
