import assert from "node:assert/strict";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import type { RateLimitRules } from "@packages/provider-contracts/rate-limit";
import { useTestServer } from "../../test-app";

const useApp = useTestServer();

function createMutableClock(startMs: number) {
	let nowMs = startMs;
	return {
		now: () => new Date(nowMs),
		advanceSeconds: (seconds: number) => {
			nowMs += seconds * 1000;
		},
	};
}

/** Default fixture with one bucket tightened and the limiter on a test-owned
 * clock, so window rollover is driven by the test instead of wall time. */
function fixtureWithTightRules(overrides: Partial<RateLimitRules>) {
	const clock = createMutableClock(1_700_000_000_000);
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	fixture.rateLimit = {
		consumeRateLimit: initInMemoryRateLimit({ now: clock.now }).consumeRateLimit,
		rules: { ...fixture.rateLimit.rules, ...overrides },
	};
	return { fixture, clock };
}

/** A loadedAt value safely older than the bot-defense minimum submit window
 * (2.5s), so the form submission passes the timing gate. */
function freshLoadedAt(): string {
	return String(Date.now() - 5000);
}

describe("Per-IP rate limiting", () => {
	describe("POST /login", () => {
		it("returns 429 past the limit and stops checking credentials", async () => {
			const { fixture } = fixtureWithTightRules({ login: { limit: 2, windowSeconds: 900 } });
			const verifyCredentials = fixture.auth.verifyCredentials;
			let credentialChecks = 0;
			fixture.auth.verifyCredentials = async (params) => {
				credentialChecks += 1;
				return verifyCredentials(params);
			};
			const harness = useApp(fixture);
			const attemptLogin = () =>
				request(harness.server)
					.post("/login")
					.type("form")
					.send({ email: "victim@example.com", password: "guess" });

			const underLimit = [await attemptLogin(), await attemptLogin()];
			const throttled = await attemptLogin();

			assert.deepEqual(underLimit.map((r) => r.status), [422, 422]);
			assert.equal(throttled.status, 429);
			assert.match(String(throttled.headers["retry-after"]), /^\d+$/);
			assert.equal(credentialChecks, 2);
		});

		it("allows login attempts again once the window resets", async () => {
			const { fixture, clock } = fixtureWithTightRules({ login: { limit: 1, windowSeconds: 900 } });
			const harness = useApp(fixture);
			await harness.auth.createUser({ email: "user@example.com", password: "password123" });
			const attemptLogin = () =>
				request(harness.server)
					.post("/login")
					.type("form")
					.send({ email: "user@example.com", password: "password123" });

			await attemptLogin();
			const throttled = await attemptLogin();
			clock.advanceSeconds(900);
			const afterReset = await attemptLogin();

			assert.equal(throttled.status, 429);
			assert.equal(afterReset.status, 303);
		});
	});

	describe("POST /signup", () => {
		it("returns 429 past the limit and does not create the account", async () => {
			const { fixture } = fixtureWithTightRules({ signup: { limit: 2, windowSeconds: 3600 } });
			const harness = useApp(fixture);
			const attemptSignup = (email: string) =>
				request(harness.server)
					.post("/signup")
					.type("form")
					.send({
						email,
						password: "password123",
						loadedAt: freshLoadedAt(),
					});

			const first = await attemptSignup("first@example.com");
			const second = await attemptSignup("second@example.com");
			const throttled = await attemptSignup("third@example.com");

			assert.deepEqual([first.status, second.status], [303, 303]);
			assert.equal(throttled.status, 429);
			assert.match(String(throttled.headers["retry-after"]), /^\d+$/);
			assert.equal(await harness.auth.findUserByEmail("third@example.com"), null);
		});
	});

	describe("POST /forgot-password", () => {
		it("returns 429 past the limit and sends no further reset emails", async () => {
			const { fixture } = fixtureWithTightRules({
				forgotPassword: { limit: 2, windowSeconds: 3600 },
			});
			const harness = useApp(fixture);
			await harness.auth.createUser({ email: "user@example.com", password: "password123" });
			const requestReset = () =>
				request(harness.server)
					.post("/forgot-password")
					.type("form")
					.send({ email: "user@example.com" });

			const underLimit = [await requestReset(), await requestReset()];
			const emailsBeforeThrottle = harness.email.getSentEmails().length;
			const throttled = await requestReset();

			assert.deepEqual(underLimit.map((r) => r.status), [200, 200]);
			assert.equal(emailsBeforeThrottle, 2);
			assert.equal(throttled.status, 429);
			assert.match(String(throttled.headers["retry-after"]), /^\d+$/);
			assert.equal(harness.email.getSentEmails().length, 2);
		});
	});
});
