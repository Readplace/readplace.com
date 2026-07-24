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
	CloseUserAccount,
	CountUsers,
	CreateAppleUser,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroySession,
	DestroyUserSessions,
	FindAppleRefreshTokenByUserId,
	FindEmailByUserId,
	FindUserById,
	FindUserByEmail,
	FindUserContactByUserId,
	FindUserIdsByPrefix,
	GetSessionUserId,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	SaveAppleRefreshToken,
	UpdatePassword,
	UserAcquisitionAttribution,
	UserExistsByEmail,
	VerifyCredentials,
} from "@packages/provider-contracts/auth";

interface StoredUser {
	id: UserId;
	email: string;
	passwordHash: string | undefined;
	appleRefreshToken: string | undefined;
	emailVerified: boolean;
	registeredAt: string;
	attribution?: UserAcquisitionAttribution;
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
	createAppleUser: CreateAppleUser;
	saveAppleRefreshToken: SaveAppleRefreshToken;
	findAppleRefreshTokenByUserId: FindAppleRefreshTokenByUserId;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	destroySession: DestroySession;
	destroyUserSessions: DestroyUserSessions;
	closeUserAccount: CloseUserAccount;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	userExistsByEmail: UserExistsByEmail;
	updatePassword: UpdatePassword;
	findUserIdsByPrefix: FindUserIdsByPrefix;
	findEmailByUserId: FindEmailByUserId;
	findUserContactByUserId: FindUserContactByUserId;
	findUserById: FindUserById;
	deleteUser: (email: string) => Promise<void>;
	/** Test-only accessor for the attribution persisted at signup, so signup
	 * tests can assert the raw utm/referrer/landing fields reached the row. */
	getAcquisitionAttribution: (email: string) => Promise<UserAcquisitionAttribution | undefined>;
} {
	const _hashPassword = opts.hashPassword;
	const _verifyPassword = opts.verifyPassword;
	const users = new Map<string, StoredUser>();
	const sessions = new Map<string, StoredSession>();
	const gmailClaims = new Map<string, UserId>();

	/** Reserves the identity atomically: rejects when either the delivery key or
	 * the Gmail identity claim is already taken, and reserves the claim on success.
	 * Returns the normalized (delivery) email, or null if taken. */
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

	const createUser: CreateUser = async ({ email, password, attribution }) => {
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
			appleRefreshToken: undefined,
			emailVerified: false,
			registeredAt: new Date().toISOString(),
			attribution,
		});

		return { ok: true, userId };
	};

	const createUserWithPasswordHash: CreateUserWithPasswordHash = async ({ email, passwordHash, attribution }) => {
		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const normalizedEmail = reserveIdentity(email, userId);
		if (normalizedEmail === null) {
			return { ok: false, reason: "email-already-exists" };
		}

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash,
			appleRefreshToken: undefined,
			emailVerified: false,
			registeredAt: new Date().toISOString(),
			attribution,
		});

		return { ok: true, userId };
	};

	/** A user created from a federated identity provider (Google/Apple): verified
	 * email, no password. Apple rows additionally carry the refresh token that
	 * account deletion revokes; Google persists no token. */
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
		const normalizedEmail = reserveIdentity(email, userId);
		if (normalizedEmail === null) {
			return { ok: false as const, reason: "email-already-exists" as const };
		}

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash: undefined,
			appleRefreshToken,
			emailVerified: true,
			registeredAt: new Date().toISOString(),
			attribution,
		});

		return { ok: true as const, userId };
	};
	const createGoogleUser: CreateGoogleUser = createFederatedUser;
	const createAppleUser: CreateAppleUser = createFederatedUser;

	const saveAppleRefreshToken: SaveAppleRefreshToken = async ({ email, appleRefreshToken }) => {
		const normalizedEmail = normalizeEmail(email);
		const user = users.get(normalizedEmail);
		assert(user, `Cannot save Apple refresh token: no user found for ${normalizedEmail}`);
		user.appleRefreshToken = appleRefreshToken;
	};

	const findAppleRefreshTokenByUserId: FindAppleRefreshTokenByUserId = async (userId) => {
		for (const user of users.values()) {
			if (user.id === userId) return user.appleRefreshToken ?? null;
		}
		return null;
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

	const verifyCredentials: VerifyCredentials = async ({ email, password }) => {
		const normalizedEmail = normalizeEmail(email);
		const user = users.get(normalizedEmail);

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

	const destroyUserSessions: DestroyUserSessions = async (userId) => {
		for (const [sessionId, session] of sessions) {
			if (session.userId === userId) sessions.delete(sessionId);
		}
	};

	const closeUserAccount: CloseUserAccount = async (userId) => {
		for (const [email, user] of users) {
			if (user.id === userId) {
				users.delete(email);
				const claimKey = gmailIdentityKey(user.email);
				if (claimKey !== null) gmailClaims.delete(claimKey);
				return;
			}
		}
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

	const findUserIdsByPrefix: FindUserIdsByPrefix = async (prefix) => {
		const userIds: UserId[] = [];
		for (const user of users.values()) {
			if (userIdPrefixFrom(user.id) === prefix) userIds.push(user.id);
		}
		return userIds;
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

	const getAcquisitionAttribution = async (email: string): Promise<UserAcquisitionAttribution | undefined> => {
		const user = users.get(normalizeEmail(email));
		return user?.attribution;
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
		createAppleUser,
		saveAppleRefreshToken,
		findAppleRefreshTokenByUserId,
		findUserByEmail,
		verifyCredentials,
		createSession,
		getSessionUserId,
		destroySession,
		destroyUserSessions,
		closeUserAccount,
		countUsers,
		markEmailVerified,
		markSessionEmailVerified,
		userExistsByEmail,
		findUserIdsByPrefix,
		updatePassword,
		findEmailByUserId,
		findUserContactByUserId,
		findUserById,
		getAcquisitionAttribution,
		deleteUser,
	};
}
