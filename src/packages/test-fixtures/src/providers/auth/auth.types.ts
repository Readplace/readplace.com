import type { UserId, UserIdPrefix } from "@packages/domain/user";

export type CreateUserResult =
	| { ok: true; userId: UserId }
	| { ok: false; reason: "email-already-exists" };

export type VerifyCredentialsResult =
	| { ok: true; userId: UserId; emailVerified: boolean }
	| { ok: false; reason: "invalid-credentials" };

export type CreateUser = (credentials: {
	email: string;
	password: string;
}) => Promise<CreateUserResult>;

export type CreateUserWithPasswordHash = (credentials: {
	email: string;
	passwordHash: string;
}) => Promise<CreateUserResult>;

export type VerifyCredentials = (credentials: {
	email: string;
	password: string;
}) => Promise<VerifyCredentialsResult>;

export type CreateSession = (session: {
	userId: UserId;
	emailVerified: boolean;
}) => Promise<string>;

export type GetSessionUserId = (
	sessionId: string,
) => Promise<{ userId: UserId; emailVerified: boolean } | null>;

export type DestroySession = (sessionId: string) => Promise<void>;

export type CountUsers = () => Promise<number>;

export type MarkEmailVerified = (email: string) => Promise<void>;

export type MarkSessionEmailVerified = (sessionId: string) => Promise<void>;

export type UserExistsByEmail = (email: string) => Promise<boolean>;

export type UpdatePassword = (args: { email: string; password: string }) => Promise<void>;

export type FindUserByEmailResult =
	| { userId: UserId; emailVerified: boolean; registeredAt?: string }
	| null;

export type FindUserByEmail = (email: string) => Promise<FindUserByEmailResult>;

export type FindEmailByUserId = (userId: UserId) => Promise<string | null>;

export type UserContact = { email: string; emailVerified: boolean };

/** Resolve a user's email + verification status by id (via the userId-index).
 * The reader-ready notifier needs both: it only emails verified addresses. */
export type FindUserContactByUserId = (
	userId: UserId,
) => Promise<UserContact | null>;

/** Atomically claim the per-user reader-ready email cooldown slot. Succeeds
 * (returns true) when no email has been sent within `cooldownMs`, writing
 * `now` as the new slot; returns false when still inside the cooldown window,
 * so the caller drops-and-logs. The conditional write is the volume cap that
 * survives concurrent fan-out deliveries. */
export type ClaimReaderReadyEmailSlot = (params: {
	userId: UserId;
	now: Date;
	cooldownMs: number;
}) => Promise<boolean>;

export type ExistsUserByIdPrefix = (prefix: UserIdPrefix) => Promise<boolean>;

export type CreateGoogleUser = (user: {
	email: string;
	userId: UserId;
}) => Promise<CreateUserResult>;
