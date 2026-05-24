import assert from "node:assert";
import { randomBytes } from "node:crypto";
import type { UserId } from "@packages/domain/user";
import { UserIdSchema } from "@packages/domain/user";
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
} from "./auth.types";
import { normalizeEmail } from "./normalize-email";

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
	deleteUser: (email: string) => Promise<void>;
} {
	const _hashPassword = opts.hashPassword;
	const _verifyPassword = opts.verifyPassword;
	const users = new Map<string, StoredUser>();
	const sessions = new Map<string, StoredSession>();

	const createUser: CreateUser = async ({ email, password }) => {
		const normalizedEmail = normalizeEmail(email);

		if (users.has(normalizedEmail)) {
			return { ok: false, reason: "email-already-exists" };
		}

		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));
		const passwordHash = await _hashPassword(password);

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash,
			emailVerified: false,
			registeredAt: new Date().toISOString(),
		});

		return { ok: true, userId };
	};

	const createUserWithPasswordHash: CreateUserWithPasswordHash = async ({ email, passwordHash }) => {
		const normalizedEmail = normalizeEmail(email);

		if (users.has(normalizedEmail)) {
			return { ok: false, reason: "email-already-exists" };
		}

		const userId = UserIdSchema.parse(randomBytes(16).toString("hex"));

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash,
			emailVerified: false,
			registeredAt: new Date().toISOString(),
		});

		return { ok: true, userId };
	};

	const createGoogleUser: CreateGoogleUser = async ({ email, userId }) => {
		const normalizedEmail = normalizeEmail(email);

		if (users.has(normalizedEmail)) {
			return { ok: false, reason: "email-already-exists" };
		}

		users.set(normalizedEmail, {
			id: userId,
			email: normalizedEmail,
			passwordHash: undefined,
			emailVerified: true,
			registeredAt: new Date().toISOString(),
		});

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
		return sessions.get(sessionId) ?? null;
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
		for (const user of users.values()) {
			if (user.id.startsWith(prefix)) return true;
		}
		return false;
	};

	const findEmailByUserId: FindEmailByUserId = async (userId) => {
		for (const user of users.values()) {
			if (user.id === userId) return user.email;
		}
		return null;
	};

	const updatePassword: UpdatePassword = async ({ email, password }) => {
		const normalizedEmail = normalizeEmail(email);
		const user = users.get(normalizedEmail);
		assert(user, `Cannot update password: no user found for ${normalizedEmail}`);
		user.passwordHash = await _hashPassword(password);
	};

	const deleteUser = async (email: string): Promise<void> => {
		users.delete(normalizeEmail(email));
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
		deleteUser,
	};
}
