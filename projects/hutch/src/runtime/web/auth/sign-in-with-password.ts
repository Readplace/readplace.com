import type { RateLimitRule } from "@packages/domain/rate-limit";
import { normalizeEmail, type UserId } from "@packages/domain/user";
import type { CreateSession, VerifyCredentials } from "@packages/provider-contracts/auth";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";

export type VerifyAccountPasswordResult =
	| { ok: true; userId: UserId; emailVerified: boolean }
	| { ok: false; reason: "invalid-credentials" }
	| { ok: false; reason: "rate-limited"; retryAfterSeconds: number };

export type VerifyAccountPassword = (credentials: {
	email: string;
	password: string;
}) => Promise<VerifyAccountPasswordResult>;

export type SignInWithPasswordResult =
	| { ok: true; sessionId: string }
	| { ok: false; reason: "invalid-credentials" }
	| { ok: false; reason: "rate-limited"; retryAfterSeconds: number };

export function initVerifyAccountPassword(deps: {
	consumeRateLimit: ConsumeRateLimit;
	loginAccountRule: RateLimitRule;
	verifyCredentials: VerifyCredentials;
}): VerifyAccountPassword {
	return async (credentials) => {
		const accountDecision = await deps.consumeRateLimit({
			bucket: "login-account",
			key: normalizeEmail(credentials.email),
			rule: deps.loginAccountRule,
		});
		if (!accountDecision.allowed) {
			return { ok: false, reason: "rate-limited", retryAfterSeconds: accountDecision.retryAfterSeconds };
		}

		return deps.verifyCredentials(credentials);
	};
}

export function initSignInWithPassword(deps: {
	consumeRateLimit: ConsumeRateLimit;
	loginAccountRule: RateLimitRule;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
}): (credentials: { email: string; password: string }) => Promise<SignInWithPasswordResult> {
	const verifyAccountPassword = initVerifyAccountPassword(deps);
	return async (credentials) => {
		const verified = await verifyAccountPassword(credentials);
		if (!verified.ok) {
			return verified;
		}

		const sessionId = await deps.createSession({ userId: verified.userId, emailVerified: verified.emailVerified });
		return { ok: true, sessionId };
	};
}
