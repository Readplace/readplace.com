import type { AuthenticatedUserId, UserId, UserIdPrefix } from "@packages/domain/user";

export type CreateUserResult =
	| { ok: true; userId: UserId }
	| { ok: false; reason: "email-already-exists" };

/** Raw acquisition attribution captured from the `hutch_click` cookie at signup
 * and persisted on the durable user row, so a cohort can be sliced by where the
 * account came from without joining 30-day-retention CloudWatch logs. The raw
 * UTM/referrer fields are stored (not a derived channel) so bucketing stays
 * flexible. Structurally identical to the runtime `ClickAttribution` — declared
 * here because provider-contracts must not import runtime code (the
 * `ConversionEvent` fields below inline the same shape for the same reason). */
export interface UserAcquisitionAttribution {
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_content?: string;
	referrer_host?: string;
	first_seen_at: string;
	landing_path: string;
}

export type VerifyCredentialsResult =
	| { ok: true; userId: UserId; emailVerified: boolean }
	| { ok: false; reason: "invalid-credentials" };

export type CreateUser = (credentials: {
	email: string;
	password: string;
	attribution?: UserAcquisitionAttribution;
}) => Promise<CreateUserResult>;

export type CreateUserWithPasswordHash = (credentials: {
	email: string;
	passwordHash: string;
	attribution?: UserAcquisitionAttribution;
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
) => Promise<{ userId: AuthenticatedUserId; emailVerified: boolean } | null>;

export type DestroySession = (sessionId: string) => Promise<void>;

export type DestroyUserSessions = (userId: UserId) => Promise<void>;

export type CloseUserAccount = (userId: UserId) => Promise<void>;

export type CountUsers = () => Promise<number>;

export type MarkEmailVerified = (email: string) => Promise<void>;

export type MarkSessionEmailVerified = (sessionId: string) => Promise<void>;

export type UserExistsByEmail = (email: string) => Promise<boolean>;

export type UpdatePassword = (args: { email: string; password: string }) => Promise<void>;

export type FindUserByEmailResult =
	| { userId: UserId; emailVerified: boolean; registeredAt?: string }
	| null;

export type FindUserByEmail = (email: string) => Promise<FindUserByEmailResult>;

export type FindUserByIdResult =
	| { userId: UserId; emailVerified: boolean; registeredAt?: string }
	| null;

export type FindUserById = (userId: UserId) => Promise<FindUserByIdResult>;

export type FindEmailByUserId = (userId: UserId) => Promise<string | null>;

export type UserContact = { email: string; emailVerified: boolean };

/** Resolve a user's email + verification status by id (via the userId-index).
 * The reader-ready notifier needs both: it only emails verified addresses. */
export type FindUserContactByUserId = (
	userId: UserId,
) => Promise<UserContact | null>;

export type FindUserIdsByPrefix = (prefix: UserIdPrefix) => Promise<UserId[]>;

export type CreateGoogleUser = (user: {
	email: string;
	userId: UserId;
	attribution?: UserAcquisitionAttribution;
}) => Promise<CreateUserResult>;

export type CreateAppleUser = (user: {
	email: string;
	userId: UserId;
	appleRefreshToken: string;
	attribution?: UserAcquisitionAttribution;
}) => Promise<CreateUserResult>;

/** Upserts the Apple refresh_token onto an existing user's row. Apple mints a
 * fresh refresh_token on every code exchange, and a returning user may predate
 * token persistence — so every Apple login stores the newest grant, keeping
 * account-deletion revocation possible for all Sign in with Apple users. */
export type SaveAppleRefreshToken = (params: {
	email: string;
	appleRefreshToken: string;
}) => Promise<void>;

export type FindAppleRefreshTokenByUserId = (userId: UserId) => Promise<string | null>;

export type BotDefenseRejectReason =
	| "honeypot"
	| "submit_too_fast"
	| "missing_timestamp"
	| "invalid_timestamp";

export interface BotDefenseEvent {
	stream: "bot-defense";
	event: "signup_rejected";
	reason: BotDefenseRejectReason;
	timestamp: string;
	ip?: string;
	user_agent?: string;
	email_domain?: string;
	time_to_submit_ms?: number;
}

export interface ConversionEvent {
	stream: "conversions";
	event: "user_created";
	timestamp: string;
	user_id: UserId;
	email_hash: string;
	method: "email" | "google" | "apple";
	tier: "free" | "trial";
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_content?: string;
	referrer_host?: string;
	first_seen_at?: string;
	landing_path?: string;
	visitor_id?: string;
	/** The homepage A/B arm (`variant-a` / `variant-b`) the visitor was assigned
	 * when they landed, read from the server-written experiment cookie at signup.
	 * Absent when the visitor was never assigned an arm (a signup that started
	 * somewhere other than the homepage, a crawler kept on the incumbent arm, or a
	 * cleared/stale-epoch cookie). This is the only field that lets a conversion be
	 * attributed to an arm. */
	homepage_variant?: string;
	/** The id minted when an anonymous save was held behind the sign-in wall
	 * (carried on the matching `view_save_intent`), so a signup-blocked save can
	 * be traced to the account it eventually created. Absent when the signup did
	 * not follow a pending save. */
	pending_save_id?: string;
}
