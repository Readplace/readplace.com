import assert from "node:assert";
import { randomBytes } from "node:crypto";
import type { UserId } from "@packages/domain/user";
import {
	UserIdSchema,
	authenticatedUserIdFrom,
	userIdPrefixFrom,
	normalizeEmail,
	gmailIdentityKey,
} from "@packages/domain/user";
import type {
	ClearPasswordHash,
	CountUsers,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroySession,
	DestroyUserSessions,
	ExistsUserByIdPrefix,
	FindEmailByUserId,
	FindUserById,
	FindUserByCanonicalEmail,
	FindUserByEmail,
	FindUserContactByUserId,
	GetSessionUserId,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	UpdatePassword,
	UserExistsByEmail,
	VerifyCredentials,
} from "@packages/provider-contracts/auth";

interface StoredUser {
	id: UserId;
	email: string;
	passwordHash: string | undefined;
	emailVerified: boolean;
	registeredAt: string;
}

interface StoredSession {
	userId: UserId;
	emailVerified: boolean;
}

export function initInMemoryAuth(opts: {
	hashPassword: (password: string) => Promise<string>;
	verifyPassword: (password: string, stored: string | undefined) => Promise<boolean>;
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
	updatePassword: UpdatePassword;
	existsUserByIdPrefix: ExistsUserByIdPrefix;
	findEmailByUserId: FindEmailByUserId;
	findUserContactByUserId: FindUserContactByUserId;
	findUserById: FindUserById;
	findUserByCanonicalEmail: FindUserByCanonicalEmail;
	clearPasswordHash: ClearPasswordHash;
	destroyUserSessions: DestroyUserSessions;
	deleteUser: (email: string) => Promise<void>;
} {
	const _hashPassword = opts.hashPassword;
	const _verifyPassword = opts.verifyPassword;
	const users = new Map<string, StoredUser>();
	const sessions = new Map<string, StoredSession>();
	const userIdPrefixes = new Set<string>();
	const gmailClaims = new Map<string, UserId>();

	/** Mirrors the DynamoDB claim-item transaction: rejects when either the
	 * delivery key or the Gmail identity claim is already taken, and reserves the
	 * claim on success. Returns the normalized (delivery) email, or null if taken. */
	const reserveIdentity = (email: string, userId: UserId): string | null => {
		const normalizedEmail = normalizeEmail(email);
		const claimKey = gmailIdentityKey(email);
		if (users.has(normalizedEmail) || (claimKey !== null && gmailClaims.has(claimKey))) {
			return null;
		}
		if (claimKey !== null) {
			gmailClaims.set(claimKey, userId);
		}
		return normalizedEmail;
	};

	const createUser: CreateUser = async ({ email, password }) => {
		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const normalizedEmail = reserveIdentity(email, userId);
		if (normalizedEmail === null) {
			return { ok: false, reason: "email-already-exists" };
		}
		const passwordHash = await _hashPassword(password);

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash,
			emailVerified: false,
			registeredAt: new Date().toISOString(),
		});
		userIdPrefixes.add(userIdPrefixFrom(userId));

		return { ok: true, userId };
	};

	const createUserWithPasswordHash: CreateUserWithPasswordHash = async ({ email, passwordHash }) => {
		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const normalizedEmail = reserveIdentity(email, userId);
		if (normalizedEmail === null) {
			return { ok: false, reason: "email-already-exists" };
		}

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash,
			emailVerified: false,
			registeredAt: new Date().toISOString(),
		});
		userIdPrefixes.add(userIdPrefixFrom(userId));

		return { ok: true, userId };
	};

	const createGoogleUser: CreateGoogleUser = async ({ email, userId }) => {
		const normalizedEmail = reserveIdentity(email, userId);
		if (normalizedEmail === null) {
			return { ok: false, reason: "email-already-exists" };
		}

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash: undefined,
			emailVerified: true,
			registeredAt: new Date().toISOString(),
		});
		userIdPrefixes.add(userIdPrefixFrom(userId));

		return { ok: true, userId };
	};

	const findUserByEmail: FindUserByEmail = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		const user = users.get(normalizedEmail);
		if (!user) return null;
		return {
			userId: user.id,
			emailVerified: user.emailVerified,
			registeredAt: user.registeredAt,
		};
	};

	// Resolve a stored user by exact delivery email, or — for a Gmail variant
	// spelling — via the canonical claim to its owner row.
	const resolveStoredUser = (email: string): StoredUser | undefined => {
		const exact = users.get(normalizeEmail(email));
		if (exact) return exact;
		const claimKey = gmailIdentityKey(email);
		if (claimKey === null) return undefined;
		const ownerUserId = gmailClaims.get(claimKey);
		if (ownerUserId === undefined) return undefined;
		return [...users.values()].find((u) => u.id === ownerUserId);
	};

	const findUserByCanonicalEmail: FindUserByCanonicalEmail = async (email) => {
		const user = resolveStoredUser(email);
		if (!user) return null;
		return {
			userId: user.id,
			email: user.email,
			emailVerified: user.emailVerified,
			hasPassword: user.passwordHash !== undefined,
		};
	};

	const verifyCredentials: VerifyCredentials = async ({ email, password }) => {
		const user = resolveStoredUser(email);

		if (!user) {
			return { ok: false, reason: "invalid-credentials" };
		}

		const valid = await _verifyPassword(password, user.passwordHash);
		if (!valid) {
			return { ok: false, reason: "invalid-credentials" };
		}

		return { ok: true, userId: user.id, emailVerified: user.emailVerified };
	};

	const createSession: CreateSession = async ({ userId, emailVerified }) => {
		const sessionId = randomBytes(32).toString("hex");
		sessions.set(sessionId, { userId, emailVerified });
		return sessionId;
	};

	const getSessionUserId: GetSessionUserId = async (sessionId) => {
		const session = sessions.get(sessionId);
		if (!session) return null;
		return {
			userId: authenticatedUserIdFrom(session.userId),
			emailVerified: session.emailVerified,
		};
	};

	const destroySession: DestroySession = async (sessionId) => {
		sessions.delete(sessionId);
	};

	const countUsers: CountUsers = async () => {
		return users.size;
	};

	const markEmailVerified: MarkEmailVerified = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		const user = users.get(normalizedEmail);
		assert(user, `Cannot mark email verified: no user found for ${normalizedEmail}`);
		user.emailVerified = true;
	};

	const markSessionEmailVerified: MarkSessionEmailVerified = async (sessionId) => {
		const session = sessions.get(sessionId);
		if (session) {
			session.emailVerified = true;
		}
	};

	const userExistsByEmail: UserExistsByEmail = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		return users.has(normalizedEmail);
	};

	const existsUserByIdPrefix: ExistsUserByIdPrefix = async (prefix) => {
		return userIdPrefixes.has(prefix);
	};

	const findEmailByUserId: FindEmailByUserId = async (userId) => {
		for (const user of users.values()) {
			if (user.id === userId) return user.email;
		}
		return null;
	};

	const findUserContactByUserId: FindUserContactByUserId = async (userId) => {
		for (const user of users.values()) {
			if (user.id === userId) {
				return { email: user.email, emailVerified: user.emailVerified };
			}
		}
		return null;
	};

	const findUserById: FindUserById = async (userId) => {
		for (const user of users.values()) {
			if (user.id === userId) {
				return {
					userId: user.id,
					emailVerified: user.emailVerified,
					registeredAt: user.registeredAt,
				};
			}
		}
		return null;
	};

	const updatePassword: UpdatePassword = async ({ email, password }) => {
		const normalizedEmail = normalizeEmail(email);
		const user = users.get(normalizedEmail);
		assert(user, `Cannot update password: no user found for ${normalizedEmail}`);
		user.passwordHash = await _hashPassword(password);
	};

	const clearPasswordHash: ClearPasswordHash = async (email) => {
		const normalizedEmail = normalizeEmail(email);
		const user = users.get(normalizedEmail);
		assert(user, `Cannot clear password: no user found for ${normalizedEmail}`);
		user.passwordHash = undefined;
	};

	const destroyUserSessions: DestroyUserSessions = async (userId) => {
		for (const [sessionId, session] of sessions) {
			if (session.userId === userId) {
				sessions.delete(sessionId);
			}
		}
	};

	const deleteUser = async (email: string): Promise<void> => {
		users.delete(normalizeEmail(email));
		const claimKey = gmailIdentityKey(email);
		if (claimKey !== null) {
			gmailClaims.delete(claimKey);
		}
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
		findUserContactByUserId,
		findUserById,
		findUserByCanonicalEmail,
		clearPasswordHash,
		destroyUserSessions,
		deleteUser,
	};
}
