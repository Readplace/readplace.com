import type { RateLimitDecision, RateLimitRule } from "@packages/domain/rate-limit";
import { UserIdSchema } from "@packages/domain/user";
import type { CreateSession, VerifyCredentials, VerifyCredentialsResult } from "@packages/provider-contracts/auth";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { initSignInWithPassword } from "./sign-in-with-password";

const RULE: RateLimitRule = { limit: 5, windowSeconds: 900 };

function recordingDeps(outcomes: { decision: RateLimitDecision; verified: VerifyCredentialsResult }) {
	const rateLimitCalls: Parameters<ConsumeRateLimit>[0][] = [];
	const verifyCalls: Parameters<VerifyCredentials>[0][] = [];
	const sessionCalls: Parameters<CreateSession>[0][] = [];
	const consumeRateLimit: ConsumeRateLimit = async (params) => {
		rateLimitCalls.push(params);
		return outcomes.decision;
	};
	const verifyCredentials: VerifyCredentials = async (credentials) => {
		verifyCalls.push(credentials);
		return outcomes.verified;
	};
	const createSession: CreateSession = async (session) => {
		sessionCalls.push(session);
		return "sid-1";
	};
	const signInWithPassword = initSignInWithPassword({
		consumeRateLimit,
		loginAccountRule: RULE,
		verifyCredentials,
		createSession,
	});
	return { signInWithPassword, rateLimitCalls, verifyCalls, sessionCalls };
}

describe("initSignInWithPassword", () => {
	it("counts the attempt against the normalised address, then opens a session for a matching password", async () => {
		const userId = UserIdSchema.parse("user_1");
		const { signInWithPassword, rateLimitCalls, verifyCalls, sessionCalls } = recordingDeps({
			decision: { allowed: true },
			verified: { ok: true, userId, emailVerified: true },
		});

		const result = await signInWithPassword({ email: "Alice@Example.com", password: "correct-horse" });

		expect(result).toEqual({ ok: true, sessionId: "sid-1" });
		expect(rateLimitCalls).toEqual([{ bucket: "login-account", key: "alice@example.com", rule: RULE }]);
		expect(verifyCalls).toEqual([{ email: "Alice@Example.com", password: "correct-horse" }]);
		expect(sessionCalls).toEqual([{ userId, emailVerified: true }]);
	});

	it("refuses a throttled account before the password is checked", async () => {
		const { signInWithPassword, verifyCalls, sessionCalls } = recordingDeps({
			decision: { allowed: false, retryAfterSeconds: 42 },
			verified: { ok: true, userId: UserIdSchema.parse("user_1"), emailVerified: true },
		});

		const result = await signInWithPassword({ email: "alice@example.com", password: "correct-horse" });

		expect(result).toEqual({ ok: false, reason: "rate-limited", retryAfterSeconds: 42 });
		expect(verifyCalls).toEqual([]);
		expect(sessionCalls).toEqual([]);
	});

	it("counts a wrong password against the account and opens no session", async () => {
		const { signInWithPassword, rateLimitCalls, sessionCalls } = recordingDeps({
			decision: { allowed: true },
			verified: { ok: false, reason: "invalid-credentials" },
		});

		const result = await signInWithPassword({ email: "alice@example.com", password: "wrong-horse" });

		expect(result).toEqual({ ok: false, reason: "invalid-credentials" });
		expect(rateLimitCalls).toEqual([{ bucket: "login-account", key: "alice@example.com", rule: RULE }]);
		expect(sessionCalls).toEqual([]);
	});

	it("carries an unverified account's state onto the session it opens", async () => {
		const userId = UserIdSchema.parse("user_1");
		const { signInWithPassword, sessionCalls } = recordingDeps({
			decision: { allowed: true },
			verified: { ok: true, userId, emailVerified: false },
		});

		await signInWithPassword({ email: "alice@example.com", password: "correct-horse" });

		expect(sessionCalls).toEqual([{ userId, emailVerified: false }]);
	});
});
