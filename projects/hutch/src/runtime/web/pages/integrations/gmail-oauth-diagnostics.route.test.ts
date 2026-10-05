import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import request from "supertest";
import { GmailAccountEmailSchema } from "@packages/domain/gmail";
import type { GmailAccountEmail } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import { GMAIL_READONLY_SCOPE, GMAIL_SCOPES } from "@packages/provider-contracts/gmail-oauth";
import type { GmailGrantResult } from "@packages/provider-contracts/gmail-oauth";
import { type InMemoryGmailIntegration, initInMemoryGmailIntegration } from "@packages/test-fixtures/providers/gmail-integration";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { TEST_APP_ORIGIN, createDefaultTestAppFixture } from "@packages/test-fixtures";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";
import { signState } from "../../auth/oauth-state";
import { loginAgent, useTestServer } from "../../../test-app";

const useApp = useTestServer();

const CONNECT = "/newsletters/gmail/connect";
const CALLBACK = "/integrations/gmail/callback";
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const STATE_TTL_MS = 5 * 60 * 1000;
const ONE_DAY_MS = 86_400_000;
const READER_EMAIL = "test@example.com";
const STATE_SECRET = "test-state-secret";

const RECEIVED = "gmail.oauth.request.received";
const ISSUED = "gmail.oauth.state.issued";
const INSPECTED = "gmail.oauth.callback.inspected";
const COMPLETED = "gmail.oauth.request.completed";

type DiagnosticLine = Record<string, unknown>;
type Harness = ReturnType<typeof useApp>;

function grantOk(): GmailGrantResult {
	return {
		ok: true,
		grant: { refreshToken: "refresh-value", accessToken: "access-value", grantedScope: GMAIL_SCOPES },
	};
}

function fixtureWithGmail(
	grant: GmailGrantResult = grantOk(),
	accountEmail: GmailApiResult<GmailAccountEmail> = { ok: true, value: GmailAccountEmailSchema.parse("reader@gmail.com") },
) {
	const gmail = initInMemoryGmailIntegration({ grant, accountEmail, addresses: initInMemoryInboxAddress({ now: () => new Date() }) });
	const fixture = {
		...createDefaultTestAppFixture(TEST_APP_ORIGIN),
		gmailIntegration: gmail.bundle,
	};
	return { fixture, gmail };
}

async function readerId(harness: Harness): Promise<UserId> {
	const userId = (await harness.auth.findUserByEmail(READER_EMAIL))?.userId;
	assert(userId, "seeded login user must exist");
	return userId;
}

async function signedInCookies(harness: Harness): Promise<string[]> {
	await harness.auth.createUser({ email: READER_EMAIL, password: "password123" });
	const login = await request(harness.server)
		.post("/login")
		.set("User-Agent", BROWSER_USER_AGENT)
		.type("form")
		.send({ email: READER_EMAIL, password: "password123" });
	const session = login.headers["set-cookie"];
	assert(Array.isArray(session), "signing in must set the session cookie");
	return session.map((cookie: string) => cookie.split(";")[0]);
}

function diagnostics(gmail: InMemoryGmailIntegration): DiagnosticLine[] {
	return gmail.diagnosticLines.map((line): DiagnosticLine => JSON.parse(line));
}

async function traced(
	gmail: InMemoryGmailIntegration,
	send: () => PromiseLike<request.Response>,
): Promise<{ response: request.Response; lines: DiagnosticLine[] }> {
	const from = gmail.diagnosticLines.length;
	const response = await send();
	return { response, lines: diagnostics(gmail).slice(from) };
}

function captureErrorWrites(gmail: InMemoryGmailIntegration): string[] {
	const capture = gmail.bundle.diagnosticsLogger;
	const errorWrites: string[] = [];
	gmail.bundle.diagnosticsLogger = {
		...capture,
		error: (...parts: unknown[]) => {
			errorWrites.push(parts.map(String).join(" "));
			capture.error(...parts);
		},
	};
	return errorWrites;
}

function only(lines: DiagnosticLine[], event: string): DiagnosticLine {
	const matching = lines.filter((line) => line.event === event);
	assert.equal(matching.length, 1, `exactly one ${event} diagnostic must be recorded`);
	return matching[0];
}

function fingerprint(state: string): string {
	return createHash("sha256").update(state).digest("hex");
}

function stateOf(response: request.Response): string {
	const target = response.headers.location ?? response.headers["hx-redirect"];
	assert(typeof target === "string", "the connect response must send the reader to Google");
	const state = new URL(target).searchParams.get("state");
	assert(state, "the authorize URL must carry the signed state");
	return state;
}

function stateCookieWrites(response: request.Response): string[][] {
	const raw = response.headers["set-cookie"];
	const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return cookies
		.filter((cookie) => cookie.startsWith("hutch_gmail_state="))
		.map((cookie) => cookie.split("; ").filter((attribute) => !attribute.startsWith("Expires=")));
}

function issuedCookie(state: string): string[][] {
	return [[`hutch_gmail_state=${encodeURIComponent(state)}`, "Max-Age=300", "Path=/", "HttpOnly", "SameSite=Lax"]];
}

const CLEARED_COOKIE = [["hutch_gmail_state=", "Path=/"]];

function withStateCookie(input: { session: string[]; state: string }): string {
	return [...input.session, `hutch_gmail_state=${encodeURIComponent(input.state)}`].join("; ");
}

describe("Gmail OAuth diagnostics", () => {
	it("explains a callback that returns with an older consent's state after a second connect replaced the cookie, then traces the retry that connects", async () => {
		const { fixture, gmail } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(harness);

		const startA = await traced(gmail, () => agent.post(CONNECT).send());
		const stateA = stateOf(startA.response);
		const startB = await traced(gmail, () => agent.post(CONNECT).send());
		const stateB = stateOf(startB.response);

		expect(stateCookieWrites(startA.response)).toEqual(issuedCookie(stateA));
		expect(stateCookieWrites(startB.response)).toEqual(issuedCookie(stateB));
		expect(only(startA.lines, ISSUED)).toMatchObject({
			route: "connect",
			userId,
			issuedStateFingerprint: fingerprint(stateA),
			previousCookie: { present: false },
			intentKind: "connect",
		});
		expect(only(startB.lines, ISSUED)).toMatchObject({
			issuedStateFingerprint: fingerprint(stateB),
			previousCookie: {
				present: true,
				fingerprint: fingerprint(stateA),
				signatureValid: true,
				payload: "valid",
				intentKind: "connect",
			},
		});

		const raced = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state: stateA }));

		expect(raced.response.status).toBe(303);
		expect(raced.response.headers.location).toBe("/newsletters?error=oauth_state");
		expect(stateCookieWrites(raced.response)).toEqual(CLEARED_COOKIE);
		expect(raced.lines.map((line) => line.event)).toEqual([RECEIVED, INSPECTED, COMPLETED]);
		expect(new Set(raced.lines.map((line) => line.traceId)).size).toBe(1);
		expect(only(raced.lines, INSPECTED)).toEqual({
			version: 1,
			timestamp: expect.any(String),
			route: "callback",
			traceId: expect.any(String),
			requestId: undefined,
			userId,
			event: INSPECTED,
			level: "INFO",
			providerError: undefined,
			codePresent: true,
			queryShape: "valid",
			queryState: {
				present: true,
				fingerprint: fingerprint(stateA),
				signatureValid: true,
				payload: "valid",
				createdAtMs: expect.any(Number),
				ageMs: expect.any(Number),
				intentKind: "connect",
			},
			cookieState: {
				present: true,
				fingerprint: fingerprint(stateB),
				signatureValid: true,
				payload: "valid",
				createdAtMs: expect.any(Number),
				ageMs: expect.any(Number),
				intentKind: "connect",
			},
			statesEqual: false,
			verifiedAgeMs: expect.any(Number),
			decisionAgeMs: expect.any(Number),
			ttlMs: STATE_TTL_MS,
			decision: "state-mismatch",
		});
		expect(only(raced.lines, COMPLETED)).toMatchObject({
			level: "INFO",
			completion: "finished",
			status: 303,
			stage: "state-check",
			redirect: "integrations",
			outcome: "oauth_state",
		});

		const startC = await traced(gmail, () => agent.post(CONNECT).send());
		const stateC = stateOf(startC.response);
		expect(only(startC.lines, ISSUED)).toMatchObject({ issuedStateFingerprint: fingerprint(stateC), previousCookie: { present: false } });

		const retried = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state: stateC }));

		expect(retried.response.headers.location).toBe("/newsletters/gmail?notice=connected");
		expect(stateCookieWrites(retried.response)).toEqual(CLEARED_COOKIE);
		expect(only(retried.lines, INSPECTED)).toMatchObject({
			queryState: { fingerprint: fingerprint(stateC) },
			cookieState: { fingerprint: fingerprint(stateC) },
			statesEqual: true,
			decision: "accepted",
		});
		expect(only(retried.lines, COMPLETED)).toMatchObject({ status: 303, stage: "done", redirect: "gmail", outcome: "connected" });
		const traceIds = [startA, startB, raced, startC, retried].map(({ lines }) => new Set(lines.map((line) => line.traceId)));
		expect(traceIds.map((ids) => ids.size)).toEqual([1, 1, 1, 1, 1]);
		expect(new Set(traceIds.flatMap((ids) => [...ids])).size).toBe(5);
		expect(new Set(diagnostics(gmail).map((line) => line.userId))).toEqual(new Set([userId]));
	});

	it("traces a connect from the request it received to Google's consent screen", async () => {
		const { fixture, gmail } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const userId = await readerId(harness);

		const { response, lines } = await traced(gmail, () => agent.post(CONNECT).send());

		expect(response.status).toBe(303);
		expect(new URL(response.headers.location).origin + new URL(response.headers.location).pathname).toBe(GOOGLE_AUTHORIZE);
		expect(lines.map((line) => line.event)).toEqual([RECEIVED, ISSUED, COMPLETED]);
		expect(only(lines, RECEIVED)).toEqual({
			version: 1,
			timestamp: expect.any(String),
			route: "connect",
			traceId: expect.any(String),
			userId,
			event: RECEIVED,
			level: "INFO",
			method: "POST",
			hxRequest: false,
		});
		expect(only(lines, COMPLETED)).toEqual({
			version: 1,
			timestamp: expect.any(String),
			route: "connect",
			traceId: expect.any(String),
			requestId: undefined,
			userId,
			event: COMPLETED,
			level: "INFO",
			completion: "finished",
			status: 303,
			stage: "done",
			failureReason: undefined,
			redirect: "google-authorize",
			outcome: undefined,
			durationMs: expect.any(Number),
		});
	});

	it("traces an htmx connect that is handed Google's consent screen through HX-Redirect", async () => {
		const { fixture, gmail } = fixtureWithGmail();
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const { response, lines } = await traced(gmail, () => agent.post(CONNECT).set("HX-Request", "true").send());

		expect(response.status).toBe(200);
		expect(response.headers.location).toBeUndefined();
		expect(stateCookieWrites(response)).toEqual(issuedCookie(stateOf(response)));
		expect(only(lines, RECEIVED)).toMatchObject({ method: "POST", hxRequest: true });
		expect(only(lines, COMPLETED)).toMatchObject({ status: 200, stage: "done", redirect: "google-authorize" });
	});

	describe("a request a guard turns away", () => {
		it("records a signed-out callback as stopped before any write guard, sent to sign in", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);

			const { response, lines } = await traced(gmail, () => request(harness.server).get(CALLBACK).query({ code: "auth-code", state: "whatever" }));

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/login?return=%2Fnewsletters%3Ferror%3Doauth_signed_out");
			expect(lines.map((line) => line.event)).toEqual([RECEIVED, COMPLETED]);
			expect(only(lines, COMPLETED)).toEqual({
				version: 1,
				timestamp: expect.any(String),
				route: "callback",
				traceId: expect.any(String),
				requestId: undefined,
				userId: undefined,
				event: COMPLETED,
				level: "INFO",
				completion: "finished",
				status: 303,
				stage: "returnSignedOutReader",
				failureReason: undefined,
				redirect: "login",
				outcome: undefined,
				durationMs: expect.any(Number),
			});
		});

		it("records an unauthenticated connect as stopped by requireAuth", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);

			const { response, lines } = await traced(gmail, () => request(harness.server).post(CONNECT).send());

			expect(response.headers.location).toBe("/login");
			expect(stateCookieWrites(response)).toEqual([]);
			expect(only(lines, COMPLETED)).toMatchObject({ route: "connect", status: 303, stage: "requireAuth", redirect: "login" });
		});

		it("records a locked reader as stopped by requireNotLocked on the locked screen", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			fixture.shared.now = () => new Date(Date.now() + 8 * ONE_DAY_MS);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const { response, lines } = await traced(gmail, () => agent.post(CONNECT).set("Accept", "text/html").send());

			expect(response.text).toContain("Your account is locked");
			expect(only(lines, COMPLETED)).toEqual({
				version: 1,
				timestamp: expect.any(String),
				route: "connect",
				traceId: expect.any(String),
				requestId: undefined,
				userId: await readerId(harness),
				event: COMPLETED,
				level: "INFO",
				completion: "finished",
				status: response.status,
				stage: "requireNotLocked",
				failureReason: undefined,
				redirect: undefined,
				outcome: undefined,
				durationMs: expect.any(Number),
			});
		});

		it.each([
			["a page navigation", undefined, 303],
			["an htmx request", "true", 200],
		])("records a trial reader's %s as stopped by requireGmailConnectionAccess", async (_label, hxRequest, status) => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await harness.subscriptionProviders.upsertTrialing({
				userId: await readerId(harness),
				trialEndsAt: new Date(Date.now() + ONE_DAY_MS).toISOString(),
			});
			const started = agent.post(CONNECT).set("Accept", "text/html");
			if (hxRequest !== undefined) started.set("HX-Request", hxRequest);

			const { response, lines } = await traced(gmail, () => started.send());

			expect(response.status).toBe(status);
			expect(response.headers.location ?? response.headers["hx-redirect"]).toBe("/newsletters");
			expect(stateCookieWrites(response)).toEqual([]);
			expect(only(lines, COMPLETED)).toEqual({
				version: 1,
				timestamp: expect.any(String),
				route: "connect",
				traceId: expect.any(String),
				requestId: undefined,
				userId: await readerId(harness),
				event: COMPLETED,
				level: "INFO",
				completion: "finished",
				status,
				stage: "requireGmailConnectionAccess",
				failureReason: undefined,
				redirect: "integrations",
				outcome: undefined,
				durationMs: expect.any(Number),
			});
		});

		it("records a reader whose write access lapsed after the Gmail access check as stopped by requireWriteAccess", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			const findSubscription = fixture.subscriptionProviders.findByUserId;
			let passGmailAccessCheck = false;
			fixture.subscriptionProviders.findByUserId = async (userId) => {
				if (!passGmailAccessCheck) return findSubscription(userId);
				passGmailAccessCheck = false;
				return undefined;
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await harness.subscriptionProviders.upsertTrialing({
				userId: await readerId(harness),
				trialEndsAt: new Date(Date.now() - ONE_DAY_MS).toISOString(),
			});
			passGmailAccessCheck = true;

			const { response, lines } = await traced(gmail, () => agent.post(CONNECT).set("Accept", "text/html").send());

			expect(response.status).toBe(303);
			expect(response.headers.location).toBe("/queue?inactive=1");
			expect(stateCookieWrites(response)).toEqual([]);
			expect(only(lines, COMPLETED)).toMatchObject({ status: 303, stage: "requireWriteAccess", redirect: "other" });
		});
	});

	describe("a callback the state check refuses", () => {
		it("reports a callback without Google's state as a malformed query", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const state = stateOf(await agent.post(CONNECT).send());

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code" }));

			expect(response.headers.location).toBe("/newsletters?error=oauth_state");
			expect(stateCookieWrites(response)).toEqual(CLEARED_COOKIE);
			expect(only(lines, INSPECTED)).toMatchObject({
				codePresent: true,
				queryShape: "malformed",
				queryState: { present: false },
				cookieState: { present: true, fingerprint: fingerprint(state), payload: "valid" },
				decision: "malformed-query",
			});
			expect(only(lines, COMPLETED)).toMatchObject({ stage: "state-check", redirect: "integrations", outcome: "oauth_state" });
		});

		it("reports a callback that carries no state cookie at all", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state: "whatever" }));

			expect(response.headers.location).toBe("/newsletters?error=oauth_state");
			expect(only(lines, INSPECTED)).toMatchObject({
				queryShape: "valid",
				queryState: { present: true, fingerprint: fingerprint("whatever"), signatureValid: false },
				cookieState: { present: false },
				statesEqual: false,
				decision: "missing-cookie",
			});
			expect(only(lines, COMPLETED)).toMatchObject({ stage: "state-check", outcome: "oauth_state" });
		});

		it.each([
			["a tampered signature", "tampered.signature", { signatureValid: false }, "invalid-signature"],
			[
				"a payload signed before connect intents existed",
				signState({ payload: JSON.stringify({ nonce: "n", createdAt: Date.now() }), secret: STATE_SECRET }),
				{ signatureValid: true, payload: "schema-rejected" },
				"invalid-payload",
			],
		])("reports a state cookie carrying %s", async (_label, state, cookieState, decision) => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const session = await signedInCookies(harness);

			const { response, lines } = await traced(gmail, () =>
				request(harness.server)
					.get(CALLBACK)
					.query({ code: "auth-code", state })
					.set("User-Agent", BROWSER_USER_AGENT)
					.set("Cookie", withStateCookie({ session, state })),
			);

			expect(response.headers.location).toBe("/newsletters?error=oauth_state");
			expect(only(lines, INSPECTED)).toMatchObject({
				queryState: { present: true, fingerprint: fingerprint(state), ...cookieState },
				cookieState: { present: true, fingerprint: fingerprint(state), ...cookieState },
				statesEqual: true,
				decision,
			});
			expect(only(lines, COMPLETED)).toMatchObject({ level: "INFO", stage: "state-check", outcome: "oauth_state" });
		});

		it.each([
			[
				"signed but malformed JSON",
				signState({ payload: "not-json", secret: STATE_SECRET }),
				{ present: true, signatureValid: true, payload: "malformed-json" },
				"invalid-payload",
			],
			[
				"a non-ASCII signature that makes verification throw",
				`${signState({ payload: "{}", secret: STATE_SECRET }).slice(0, -1)}é`,
				{ present: true, signatureValid: false },
				"invalid-signature",
			],
		])("keeps the 500 for a state cookie carrying %s and records it as an error at the state check", async (_label, state, cookieState, decision) => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const session = await signedInCookies(harness);

			const { response, lines } = await traced(gmail, () =>
				request(harness.server)
					.get(CALLBACK)
					.query({ code: "auth-code", state })
					.set("User-Agent", BROWSER_USER_AGENT)
					.set("Cookie", withStateCookie({ session, state })),
			);

			expect(response.status).toBe(500);
			expect(only(lines, INSPECTED)).toMatchObject({ cookieState: { ...cookieState, fingerprint: fingerprint(state) }, decision });
			expect(only(lines, COMPLETED)).toEqual({
				version: 1,
				timestamp: expect.any(String),
				route: "callback",
				traceId: expect.any(String),
				requestId: undefined,
				userId: await readerId(harness),
				event: COMPLETED,
				level: "ERROR",
				completion: "finished",
				status: 500,
				stage: "state-check",
				failureReason: undefined,
				redirect: undefined,
				outcome: undefined,
				durationMs: expect.any(Number),
			});
		});

		it.each([
			["access_denied", "access_denied"],
			["some_future_reason", "other"],
		])("reports Google's %s answer as a provider error", async (error, providerError) => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ error }));

			expect(response.headers.location).toBe("/newsletters?error=oauth_denied");
			expect(only(lines, INSPECTED)).toMatchObject({ providerError, codePresent: false, decision: "provider-error" });
			expect(only(lines, COMPLETED)).toMatchObject({ level: "INFO", stage: "provider-error", redirect: "integrations", outcome: "oauth_denied" });
		});

		it("accepts a state exactly as old as its lifetime and refuses one a millisecond older", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			let nowMs = Date.now();
			fixture.shared.now = () => new Date(nowMs);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const onTime = stateOf(await agent.post(CONNECT).send());
			nowMs += STATE_TTL_MS;
			const atLifetime = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state: onTime }));

			expect(atLifetime.response.headers.location).toBe("/newsletters/gmail?notice=connected");
			expect(only(atLifetime.lines, INSPECTED)).toMatchObject({
				verifiedAgeMs: STATE_TTL_MS,
				decisionAgeMs: STATE_TTL_MS,
				ttlMs: STATE_TTL_MS,
				decision: "accepted",
			});

			const late = stateOf(await agent.post(CONNECT).send());
			nowMs += STATE_TTL_MS + 1;
			const pastLifetime = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state: late }));

			expect(pastLifetime.response.headers.location).toBe("/newsletters?error=oauth_state");
			expect(only(pastLifetime.lines, INSPECTED)).toMatchObject({ decisionAgeMs: STATE_TTL_MS + 1, decision: "expired" });
			expect(only(pastLifetime.lines, COMPLETED)).toMatchObject({ stage: "state-check", outcome: "oauth_state" });
		});

		it("accepts a state issued by a clock running ahead, reporting its negative age", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			let nowMs = Date.now();
			fixture.shared.now = () => new Date(nowMs);
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			nowMs += 60_000;
			const state = stateOf(await agent.post(CONNECT).send());
			nowMs -= 60_000;

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state }));

			expect(response.headers.location).toBe("/newsletters/gmail?notice=connected");
			expect(only(lines, INSPECTED)).toMatchObject({ verifiedAgeMs: -60_000, decisionAgeMs: -60_000, decision: "accepted" });
		});

		it("decides expiry on the clock reading it records, though the clock moves on during the callback", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			let nowMs = Date.now();
			fixture.shared.now = () => {
				if (diagnostics(gmail).some((line) => line.event === INSPECTED)) nowMs += 1;
				return new Date(nowMs);
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const state = stateOf(await agent.post(CONNECT).send());
			nowMs += STATE_TTL_MS;

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state }));

			expect(only(lines, INSPECTED)).toMatchObject({
				cookieState: { ageMs: STATE_TTL_MS },
				decisionAgeMs: STATE_TTL_MS,
				ttlMs: STATE_TTL_MS,
				decision: "accepted",
			});
			expect(response.headers.location).toBe("/newsletters/gmail?notice=connected");
			expect(only(lines, COMPLETED)).toMatchObject({ level: "INFO", status: 303, stage: "done", redirect: "gmail", outcome: "connected" });
			expect(Date.parse(String(only(lines, COMPLETED).timestamp)) - Date.parse(String(only(lines, INSPECTED).timestamp))).toBeGreaterThan(0);
		});
	});

	describe("a callback past the state check", () => {
		it.each([
			[{ ok: false, reason: "metadata-scope-not-granted" }, undefined, "exchange", "metadata-scope-not-granted", "oauth_metadata_scope_first_connect", "INFO", []],
			[{ ok: false, reason: "scope-not-granted" }, undefined, "exchange", "scope-not-granted", "oauth_scope", "INFO", []],
			[{ ok: false, reason: "no-refresh-token" }, undefined, "exchange", "no-refresh-token", "oauth_exchange", "ERROR", [COMPLETED]],
			[
				{ ok: false, reason: "exchange-failed", status: 400, error: "invalid_grant", errorDescription: "Malformed auth code." },
				undefined,
				"exchange",
				"exchange-failed",
				"oauth_exchange",
				"ERROR",
				[COMPLETED],
			],
			[grantOk(), { ok: false, reason: "unavailable", status: 503 }, "account-email", "unavailable", "oauth_exchange", "ERROR", [COMPLETED]],
			[grantOk(), { ok: false, reason: "reauth-required" }, "account-email", "reauth-required", "oauth_exchange", "ERROR", [COMPLETED]],
			[
				grantOk(),
				{ ok: false, reason: "rejected", status: 403, message: "Request had insufficient authentication scopes." },
				"account-email",
				"rejected",
				"oauth_exchange",
				"ERROR",
				[COMPLETED],
			],
		] satisfies [GmailGrantResult, GmailApiResult<GmailAccountEmail> | undefined, string, string, string, "INFO" | "ERROR", string[]][])(
			"records which step refused the grant (%j, %j)",
			async (grant, accountEmail, stage, failureReason, outcome, level, errorEvents) => {
				const { fixture, gmail } = fixtureWithGmail(grant, accountEmail);
				fixture.shared.logError = () => {};
				const errorWrites = captureErrorWrites(gmail);
				const harness = useApp(fixture);
				const agent = await loginAgent(harness.server, harness.auth);
				const state = stateOf(await agent.post(CONNECT).send());

				const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state }));

				expect(response.headers.location).toBe(`/newsletters?error=${outcome}`);
				expect(only(lines, INSPECTED)).toMatchObject({ decision: "accepted" });
				expect(only(lines, COMPLETED)).toMatchObject({
					level,
					status: 303,
					stage,
					failureReason,
					redirect: "integrations",
					outcome,
				});
				expect(errorWrites.map((line): DiagnosticLine => JSON.parse(line)).map((line) => line.event)).toEqual(errorEvents);
				expect(gmail.diagnosticLines.join("\n")).not.toContain("Malformed auth code.");
				expect(gmail.diagnosticLines.join("\n")).not.toContain("invalid_grant");
			},
		);

		it("records a reconnect from a different mailbox as refused at the account check", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = await readerId(harness);
			const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
			await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
			await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("different@gmail.com") });
			const state = stateOf(await agent.post(CONNECT).send());

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state }));

			expect(response.headers.location).toBe("/newsletters?error=oauth_account_changed");
			expect(only(lines, COMPLETED)).toEqual({
				version: 1,
				timestamp: expect.any(String),
				route: "callback",
				traceId: expect.any(String),
				requestId: undefined,
				userId,
				event: COMPLETED,
				level: "INFO",
				completion: "finished",
				status: 303,
				stage: "account-check",
				failureReason: undefined,
				redirect: "integrations",
				outcome: "oauth_account_changed",
				durationMs: expect.any(Number),
			});
		});

		it("records the reconnect step a thrown failure interrupted as an error", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			fixture.gmailIntegration.gmailDiscoveryStore.clearRequiresReconnect = async () => {
				throw new Error("DynamoDB unavailable");
			};
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			const userId = await readerId(harness);
			const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
			await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
			await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com") });
			const state = stateOf(await agent.post(CONNECT).send());

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state }));

			expect(response.status).toBe(500);
			expect(only(lines, COMPLETED)).toMatchObject({ level: "ERROR", status: 500, stage: "reconnect" });
			expect(gmail.diagnosticLines.join("\n")).not.toContain("DynamoDB unavailable");
		});
	});

	describe("a consent asked for to import a newsletter", () => {
		const IMPORT_FORM = { intent: "import", sender: "dan@tldr.tech" };

		it.each([
			["withheld", GMAIL_SCOPES, "import-intent", "import_permission_refused"],
			["granted", `${GMAIL_SCOPES} ${GMAIL_READONLY_SCOPE}`, "done", "import_permission_granted"],
		])("records read access %s by Google", async (_label, grantedScope, stage, outcome) => {
			const { fixture, gmail } = fixtureWithGmail({
				ok: true,
				grant: { refreshToken: "refresh-value", accessToken: "access-value", grantedScope },
			});
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);

			const started = await traced(gmail, () => agent.post(CONNECT).type("form").send(IMPORT_FORM));
			const callback = await traced(gmail, () => agent.get(CALLBACK).query({ code: "auth-code", state: stateOf(started.response) }));

			expect(callback.response.headers.location).toBe(`/newsletters/gmail?notice=${outcome}`);
			expect(only(started.lines, ISSUED)).toMatchObject({ intentKind: "import" });
			expect(only(callback.lines, INSPECTED)).toMatchObject({ cookieState: { intentKind: "import" }, decision: "accepted" });
			expect(only(callback.lines, COMPLETED)).toMatchObject({ stage, redirect: "gmail", outcome });
		});

		it("records a refusal on Google's screen as a provider error that returns to the Gmail page", async () => {
			const { fixture, gmail } = fixtureWithGmail();
			const harness = useApp(fixture);
			const agent = await loginAgent(harness.server, harness.auth);
			await agent.post(CONNECT).type("form").send(IMPORT_FORM);

			const { response, lines } = await traced(gmail, () => agent.get(CALLBACK).query({ error: "access_denied" }));

			expect(response.headers.location).toBe("/newsletters/gmail?notice=import_permission_refused");
			expect(only(lines, INSPECTED)).toMatchObject({ cookieState: { intentKind: "import" }, decision: "provider-error" });
			expect(only(lines, COMPLETED)).toMatchObject({ stage: "provider-error", redirect: "gmail", outcome: "import_permission_refused" });
		});
	});

	it.each([
		["records every line", false],
		["throws on every write", true],
	])("answers the connect and callback identically when the diagnostics logger %s", async (_label, throwing) => {
		const { fixture, gmail } = fixtureWithGmail();
		if (throwing) {
			const unavailable = () => {
				throw new Error("diagnostics sink unavailable");
			};
			const throwingLogger: HutchLogger = { info: unavailable, error: unavailable, warn: unavailable, debug: unavailable };
			fixture.gmailIntegration.diagnosticsLogger = throwingLogger;
		}
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);

		const started = await agent.post(CONNECT).send();
		const state = stateOf(started);
		const connected = await agent.get(CALLBACK).query({ code: "auth-code", state });
		const replayed = await agent.get(CALLBACK).query({ code: "auth-code", state });

		expect(started.status).toBe(303);
		expect(new URL(started.headers.location).origin + new URL(started.headers.location).pathname).toBe(GOOGLE_AUTHORIZE);
		expect(stateCookieWrites(started)).toEqual(issuedCookie(state));
		expect(connected.status).toBe(303);
		expect(connected.headers.location).toBe("/newsletters/gmail?notice=connected");
		expect(stateCookieWrites(connected)).toEqual(CLEARED_COOKIE);
		expect(replayed.status).toBe(303);
		expect(replayed.headers.location).toBe("/newsletters?error=oauth_state");
		expect(stateCookieWrites(replayed)).toEqual(CLEARED_COOKIE);
		expect(gmail.exchangedCodes).toEqual(["auth-code"]);
		expect(gmail.diagnosticLines.length > 0).toBe(!throwing);
	});

	it.each([
		["connects", { ok: true, grant: { refreshToken: "sentinel-refresh-token", accessToken: "sentinel-access-token", grantedScope: GMAIL_SCOPES } }],
		[
			"is refused by Google's token endpoint",
			{ ok: false, reason: "exchange-failed", status: 400, error: "invalid_grant", errorDescription: "sentinel-google-error-description" },
		],
	] satisfies [string, GmailGrantResult][])("keeps secrets, identities and request headers out of every line of a flow that %s", async (_label, grant) => {
		const mailbox = "sentinel.mailbox@gmail.com";
		const authCode = "sentinel-auth-code-7c41";
		const forwardedFor = "203.0.113.77";
		const referer = "https://sentinel-referrer.example/inbound";
		const { fixture, gmail } = fixtureWithGmail(grant, { ok: true, value: GmailAccountEmailSchema.parse(mailbox) });
		fixture.shared.logError = () => {};
		const harness = useApp(fixture);
		const session = await signedInCookies(harness);
		const userId = await readerId(harness);
		const gatewayAddress = await fixture.gmailIntegration.mintGatewayAddress({ userId });
		await gmail.bundle.gmailConnectionStore.createConnection({ userId, gatewayAddress });
		await gmail.bundle.gmailConnectionStore.recordAccountEmail({ userId, accountEmail: GmailAccountEmailSchema.parse(mailbox) });

		const started = await request(harness.server)
			.post(CONNECT)
			.set("User-Agent", BROWSER_USER_AGENT)
			.set("Cookie", session.join("; "))
			.set("X-Forwarded-For", forwardedFor)
			.set("Referer", referer)
			.send();
		const state = stateOf(started);
		expect(new URL(started.headers.location).searchParams.get("login_hint")).toBe(mailbox);
		await request(harness.server)
			.get(CALLBACK)
			.query({ code: authCode, state })
			.set("User-Agent", BROWSER_USER_AGENT)
			.set("Cookie", withStateCookie({ session, state }))
			.set("X-Forwarded-For", forwardedFor)
			.set("Referer", referer);
		await request(harness.server)
			.get(CALLBACK)
			.query({ error: "access_denied", error_description: "sentinel-provider-description", state })
			.set("User-Agent", BROWSER_USER_AGENT)
			.set("Cookie", withStateCookie({ session, state }));

		const [payload, mac] = [state.slice(0, state.lastIndexOf(".")), state.slice(state.lastIndexOf(".") + 1)];
		const nonce: unknown = JSON.parse(payload).nonce;
		assert(typeof nonce === "string", "the signed state must carry a nonce");
		const cookieValues = session.map((cookie) => cookie.slice(cookie.indexOf("=") + 1)).filter((value) => value.length >= 16);
		assert(cookieValues.length > 0, "the session must carry a cookie value worth checking for");
		const sentinels = [
			authCode,
			state,
			encodeURIComponent(state),
			nonce,
			mac,
			...cookieValues,
			mailbox,
			READER_EMAIL,
			"login_hint",
			"accounts.google.com",
			forwardedFor,
			referer,
			BROWSER_USER_AGENT,
			"sentinel-refresh-token",
			"sentinel-access-token",
			"sentinel-google-error-description",
			"sentinel-provider-description",
		];
		const lines = gmail.diagnosticLines;
		expect(diagnostics(gmail).map((line) => line.event)).toEqual([
			RECEIVED,
			ISSUED,
			COMPLETED,
			RECEIVED,
			INSPECTED,
			COMPLETED,
			RECEIVED,
			INSPECTED,
			COMPLETED,
		]);
		for (const sentinel of sentinels) {
			expect(lines.filter((line) => line.includes(sentinel))).toEqual([]);
		}
		for (const line of diagnostics(gmail)) {
			expect(line).not.toHaveProperty("stream");
		}
	});
});
