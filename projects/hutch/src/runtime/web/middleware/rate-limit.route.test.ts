import assert from "node:assert/strict";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
} from "@packages/test-fixtures";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import type { RateLimitRules } from "@packages/provider-contracts/rate-limit";
import { JSDOM } from "jsdom";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchAuth } from "@packages/translations/hutch-auth";
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
	fixture.rateLimit = { ...fixture.rateLimit,
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
			assert.match(String(throttled.headers["content-type"]), /^text\/plain/);
			assert.equal(throttled.text, "Too many requests from your network. Please try again later.");
			assert.equal(await harness.auth.findUserByEmail("third@example.com"), null);
		});
	});

	describe("POST /forgot-password", () => {
		const { t, tPlural } = translator(hutchAuth, DEFAULT_LOCALE);
		const withoutNonces = (html: string) => html.replace(/ nonce="[^"]*"/g, "");

		it("answers past the IP limit with the forgot-password page, a paused notice and Retry-After", async () => {
			const { fixture } = fixtureWithTightRules({
				forgotPassword: { limit: 2, windowSeconds: 86400 },
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
			const retryAfter = Number(throttled.headers["retry-after"]);
			assert.ok(Number.isInteger(retryAfter) && retryAfter > 0);
			const doc = new JSDOM(throttled.text).window.document;
			const notice = doc.querySelector('[data-test-alert="global-error"] [data-test-alert-title]');
			assert(notice, "the paused notice must be rendered");
			assert.equal(
				notice.textContent,
				tPlural("forgotPassword.ipPaused", { count: Math.ceil(retryAfter / 3600) }),
			);
			assert.equal(doc.querySelector<HTMLInputElement>("#email")?.value, "user@example.com");
			assert.equal(harness.email.getSentEmails().length, 2);
			assert.deepEqual(harness.passwordResetRefusals.events, [
				{ event: "password_reset_refused", key: "ip", retryAfterSeconds: retryAfter },
			]);
		});

		it("answers a bodiless request past the IP limit with the forgot-password page and Retry-After", async () => {
			const { fixture } = fixtureWithTightRules({
				forgotPassword: { limit: 1, windowSeconds: 86400 },
			});
			const harness = useApp(fixture);
			await request(harness.server)
				.post("/forgot-password")
				.type("form")
				.send({ email: "user@example.com" });

			const throttled = await request(harness.server).post("/forgot-password");

			assert.equal(throttled.status, 429);
			const retryAfter = Number(throttled.headers["retry-after"]);
			assert.ok(Number.isInteger(retryAfter) && retryAfter > 0);
			const doc = new JSDOM(throttled.text).window.document;
			assert.equal(
				doc.querySelector('[data-test-alert="global-error"] [data-test-alert-title]')?.textContent,
				tPlural("forgotPassword.ipPaused", { count: Math.ceil(retryAfter / 3600) }),
			);
			assert.equal(doc.querySelector<HTMLInputElement>("#email")?.value, "");
		});

		it("says less than an hour when the IP pause ends within the hour", async () => {
			const { fixture, clock } = fixtureWithTightRules({
				forgotPassword: { limit: 1, windowSeconds: 86400 },
			});
			const harness = useApp(fixture);
			const requestReset = () =>
				request(harness.server)
					.post("/forgot-password")
					.type("form")
					.send({ email: "user@example.com" });

			await requestReset();
			clock.advanceSeconds(3000);
			const throttled = await requestReset();

			assert.equal(throttled.status, 429);
			assert.ok(Number(throttled.headers["retry-after"]) < 3600);
			const notice = new JSDOM(throttled.text).window.document.querySelector('[data-test-alert="global-error"] [data-test-alert-title]');
			assert.equal(notice?.textContent, t("forgotPassword.ipPausedUnderAnHour"));
		});

		it("accepts requests from the same IP again once the UTC day rolls over", async () => {
			const { fixture, clock } = fixtureWithTightRules({
				forgotPassword: { limit: 1, windowSeconds: 86400 },
			});
			const harness = useApp(fixture);
			const requestReset = () =>
				request(harness.server)
					.post("/forgot-password")
					.type("form")
					.send({ email: "user@example.com" });

			await requestReset();
			const throttled = await requestReset();
			clock.advanceSeconds(86400);
			const nextDay = await requestReset();

			assert.deepEqual([throttled.status, nextDay.status], [429, 200]);
		});

		it("answers a spent, a known and an unknown address with the same page and sends one email", async () => {
			const { fixture } = fixtureWithTightRules({
				forgotPasswordAccount: { limit: 1, windowSeconds: 86400 },
			});
			const harness = useApp(fixture);
			await harness.auth.createUser({ email: "user@example.com", password: "password123" });
			const requestReset = (email: string) =>
				request(harness.server)
					.post("/forgot-password")
					.type("form")
					.send({ email });

			const known = await requestReset("user@example.com");
			const spent = await requestReset("user@example.com");
			const unknown = await requestReset("nobody@example.com");

			assert.deepEqual([known.status, spent.status, unknown.status], [200, 200, 200]);
			assert.equal(withoutNonces(spent.text), withoutNonces(known.text));
			assert.equal(withoutNonces(unknown.text), withoutNonces(known.text));
			assert.equal(harness.email.getSentEmails().length, 1);
			assert.deepEqual(
				harness.passwordResetRefusals.events.map(({ event, key }) => ({ event, key })),
				[{ event: "password_reset_refused", key: "address" }],
			);
		});

		it("counts an invalid address against the IP limit only", async () => {
			const { fixture } = fixtureWithTightRules({
				forgotPassword: { limit: 2, windowSeconds: 86400 },
				forgotPasswordAccount: { limit: 1, windowSeconds: 86400 },
			});
			const harness = useApp(fixture);
			await harness.auth.createUser({ email: "user@example.com", password: "password123" });
			const requestReset = (email: string) =>
				request(harness.server)
					.post("/forgot-password")
					.type("form")
					.send({ email });

			const invalid = await requestReset("not-an-email");
			const valid = await requestReset("user@example.com");
			const invalidPastLimit = await requestReset("not-an-email");

			assert.deepEqual([invalid.status, valid.status, invalidPastLimit.status], [422, 200, 429]);
			assert.equal(harness.email.getSentEmails().length, 1);
		});

		it("answers a Gmail address that is only a +tag with the same page and sends nothing", async () => {
			const harness = useApp(fixtureWithTightRules({}).fixture);
			const requestReset = (email: string) =>
				request(harness.server)
					.post("/forgot-password")
					.type("form")
					.send({ email });

			const tagOnly = await requestReset("+x@gmail.com");
			const ordinary = await requestReset("nobody@example.com");

			assert.equal(tagOnly.status, 200);
			assert.equal(withoutNonces(tagOnly.text), withoutNonces(ordinary.text));
			assert.equal(harness.email.getSentEmails().length, 0);
		});
	});

	describe("POST /auth/handoff", () => {
		it("returns 429 past the limit and stops minting codes", async () => {
			const { fixture } = fixtureWithTightRules({ browserHandoff: { limit: 1, windowSeconds: 3600 } });
			const harness = useApp(fixture);
			const attemptMint = () =>
				request(harness.server).post("/auth/handoff").set("Authorization", "Bearer not-a-real-token");

			const underLimit = await attemptMint();
			const throttled = await attemptMint();

			assert.equal(underLimit.status, 401);
			assert.equal(throttled.status, 429);
			assert.match(String(throttled.headers["retry-after"]), /^\d+$/);
		});
	});
});
