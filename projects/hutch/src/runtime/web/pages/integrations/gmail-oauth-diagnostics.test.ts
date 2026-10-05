import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { z } from "zod";
import { authenticatedUserIdFrom } from "@packages/domain/user";
import type { GmailDiagnosticEvent } from "../../../observability/gmail-diagnostics";
import { signState, verifyState } from "../../auth/oauth-state";
import {
	fingerprintGmailOAuthState,
	initGmailOAuthTrace,
	initReadGmailOAuthState,
	inspectGmailOAuthCallback,
	toGmailOAuthStateInspection,
} from "./gmail-oauth-diagnostics";

const SECRET = "unit-state-secret";
const NOW_MS = Date.parse("2026-10-05T12:00:00.000Z");
const TTL_MS = 5 * 60 * 1000;
const OWN_ORIGIN = "https://readplace.test";
const READER = authenticatedUserIdFrom("11112222333344445555666677778888");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const TestPayloadSchema = z.object({
	createdAt: z.number(),
	intent: z.object({ kind: z.enum(["connect", "import"]) }),
});

const readState = initReadGmailOAuthState({
	secret: SECRET,
	parsePayload: (json) => TestPayloadSchema.safeParse(json).data,
});

function readStateNow(value: unknown) {
	return readState({ value, checkedAtMs: NOW_MS });
}

function signedPayload(payload: unknown): string {
	return signState({ payload: JSON.stringify(payload), secret: SECRET });
}

function issuedState(input: { ageMs: number; kind?: "connect" | "import"; nonce?: string }): string {
	return signedPayload({ nonce: input.nonce ?? "nonce", createdAt: NOW_MS - input.ageMs, intent: { kind: input.kind ?? "connect" } });
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function nonAsciiSignature(signed: string): string {
	return `${signed.slice(0, -1)}é`;
}

function inspectCallback(input: { query: Record<string, string>; stateCookie: unknown }) {
	const queryShape = typeof input.query.code === "string" && typeof input.query.state === "string" ? "valid" : "malformed";
	return inspectGmailOAuthCallback({
		query: input.query,
		queryShape,
		stateCookie: input.stateCookie,
		checkedAtMs: NOW_MS,
		ttlMs: TTL_MS,
		readState,
	});
}

describe("initReadGmailOAuthState", () => {
	it.each([
		["no value at all", undefined],
		["an empty string", ""],
		["a cookie the parser turned into an object", { kind: "connect" }],
	])("reports %s as an absent state", (_label, value) => {
		expect(toGmailOAuthStateInspection(readStateNow(value))).toEqual({
			present: false,
			fingerprint: undefined,
			signatureValid: undefined,
			payload: undefined,
			createdAtMs: undefined,
			ageMs: undefined,
			intentKind: undefined,
		});
	});

	it("fingerprints the full signed string with SHA-256 and reads a verified payload's age and intent", () => {
		const state = issuedState({ ageMs: 1_000, kind: "import" });

		expect(toGmailOAuthStateInspection(readStateNow(state))).toEqual({
			present: true,
			fingerprint: sha256(state),
			signatureValid: true,
			payload: "valid",
			createdAtMs: NOW_MS - 1_000,
			ageMs: 1_000,
			intentKind: "import",
		});
		expect(fingerprintGmailOAuthState(state)).toBe(sha256(state));
	});

	it("measures a verified state's age against the instant the caller checked it at", () => {
		const state = issuedState({ ageMs: 1_000 });

		expect(toGmailOAuthStateInspection(readState({ value: state, checkedAtMs: NOW_MS + TTL_MS }))).toEqual({
			present: true,
			fingerprint: sha256(state),
			signatureValid: true,
			payload: "valid",
			createdAtMs: NOW_MS - 1_000,
			ageMs: TTL_MS + 1_000,
			intentKind: "connect",
		});
	});

	it("reports a negative age for a state created in the future", () => {
		expect(toGmailOAuthStateInspection(readStateNow(issuedState({ ageMs: -60_000 })))).toMatchObject({
			signatureValid: true,
			payload: "valid",
			ageMs: -60_000,
		});
	});

	it.each([
		["has no signature separator", "forged-state"],
		["was signed with another secret", signState({ payload: JSON.stringify({ nonce: "n", createdAt: NOW_MS, intent: { kind: "connect" } }), secret: "another-secret" })],
		["carries a tampered signature", "tampered.signature"],
	])("reports a state that %s as an invalid signature without reading its payload", (_label, state) => {
		expect(toGmailOAuthStateInspection(readStateNow(state))).toEqual({
			present: true,
			fingerprint: sha256(state),
			signatureValid: false,
			payload: undefined,
			createdAtMs: undefined,
			ageMs: undefined,
			intentKind: undefined,
		});
	});

	it("reports a state whose non-ASCII signature makes verification throw as an invalid signature instead of throwing", () => {
		const state = nonAsciiSignature(issuedState({ ageMs: 0 }));
		assert.throws(() => verifyState({ signed: state, secret: SECRET }), { name: "RangeError", code: "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH" });

		expect(readStateNow(state)).toEqual({ kind: "verification-threw", fingerprint: sha256(state) });
		expect(toGmailOAuthStateInspection(readStateNow(state))).toMatchObject({ present: true, signatureValid: false, payload: undefined });
	});

	it("tells a signed payload that is not JSON apart from one the schema rejects", () => {
		const notJson = signState({ payload: "not-json", secret: SECRET });
		const beforeIntents = signedPayload({ nonce: "n", createdAt: NOW_MS });

		expect(toGmailOAuthStateInspection(readStateNow(notJson))).toEqual({
			present: true,
			fingerprint: sha256(notJson),
			signatureValid: true,
			payload: "malformed-json",
			createdAtMs: undefined,
			ageMs: undefined,
			intentKind: undefined,
		});
		expect(toGmailOAuthStateInspection(readStateNow(beforeIntents))).toMatchObject({
			signatureValid: true,
			payload: "schema-rejected",
			ageMs: undefined,
		});
	});
});

describe("inspectGmailOAuthCallback", () => {
	it("decides a signed-but-malformed cookie first, because the route throws on it before reading Google's answer", () => {
		const notJson = signState({ payload: "not-json", secret: SECRET });

		expect(inspectCallback({ query: { error: "access_denied" }, stateCookie: notJson }).decision).toBe("invalid-payload");
		expect(inspectCallback({ query: { error: "access_denied" }, stateCookie: nonAsciiSignature(issuedState({ ageMs: 0 })) }).decision).toBe(
			"invalid-signature",
		);
	});

	it("reports a cancelled consent as a provider error before any state check", () => {
		expect(inspectCallback({ query: { error: "access_denied" }, stateCookie: undefined })).toEqual({
			event: "gmail.oauth.callback.inspected",
			level: "INFO",
			providerError: "access_denied",
			codePresent: false,
			queryShape: "malformed",
			queryState: toGmailOAuthStateInspection({ kind: "absent" }),
			cookieState: toGmailOAuthStateInspection({ kind: "absent" }),
			statesEqual: false,
			verifiedAgeMs: undefined,
			decisionAgeMs: undefined,
			ttlMs: TTL_MS,
			decision: "provider-error",
		});
	});

	it.each([
		"access_denied",
		"consent_required",
		"interaction_required",
		"login_required",
		"account_selection_required",
		"invalid_request",
		"unauthorized_client",
		"unsupported_response_type",
		"invalid_scope",
		"server_error",
		"temporarily_unavailable",
	])("keeps Google's documented error code %s", (error) => {
		expect(inspectCallback({ query: { error }, stateCookie: undefined }).providerError).toBe(error);
	});

	it.each(["some_future_code", "Reader@example.com"])("reports an undocumented error code %s as other", (error) => {
		expect(inspectCallback({ query: { error }, stateCookie: undefined }).providerError).toBe("other");
	});

	it("reports a callback without Google's state as a malformed query even when the cookie is valid", () => {
		const cookie = issuedState({ ageMs: 0 });

		expect(inspectCallback({ query: { code: "c" }, stateCookie: cookie })).toMatchObject({
			providerError: undefined,
			codePresent: true,
			queryShape: "malformed",
			queryState: { present: false },
			cookieState: { present: true, payload: "valid" },
			statesEqual: false,
			decision: "malformed-query",
		});
	});

	it.each([
		["missing-cookie", undefined],
		["invalid-signature", "tampered.signature"],
		["invalid-payload", signedPayload({ nonce: "n", createdAt: NOW_MS })],
	])("decides %s from the cookie when the query is well formed", (decision, stateCookie) => {
		expect(inspectCallback({ query: { code: "c", state: issuedState({ ageMs: 0 }) }, stateCookie }).decision).toBe(decision);
	});

	it("reports two valid states that differ as a mismatch, with each side's own fingerprint and age", () => {
		const queryState = issuedState({ ageMs: 30_000, nonce: "a" });
		const stateCookie = issuedState({ ageMs: 10_000, nonce: "b" });

		expect(inspectCallback({ query: { code: "c", state: queryState }, stateCookie })).toMatchObject({
			queryState: { fingerprint: sha256(queryState), signatureValid: true, payload: "valid", ageMs: 30_000 },
			cookieState: { fingerprint: sha256(stateCookie), signatureValid: true, payload: "valid", ageMs: 10_000 },
			statesEqual: false,
			verifiedAgeMs: 30_000,
			decisionAgeMs: 10_000,
			decision: "state-mismatch",
		});
	});

	it.each([
		["accepted", TTL_MS],
		["expired", TTL_MS + 1],
		["accepted", -60_000],
		["accepted", 0],
	])("decides %s for a matching state aged %i ms", (decision, ageMs) => {
		const state = issuedState({ ageMs });

		expect(inspectCallback({ query: { code: "c", state }, stateCookie: state })).toMatchObject({
			statesEqual: true,
			verifiedAgeMs: ageMs,
			decisionAgeMs: ageMs,
			ttlMs: TTL_MS,
			decision,
		});
	});
});

function recordingTrace(now: () => Date) {
	const events: Record<string, unknown>[] = [];
	const waiting: { event: string; resolve: () => void }[] = [];
	const trace = initGmailOAuthTrace({
		record: (event: GmailDiagnosticEvent) => {
			events.push(JSON.parse(JSON.stringify(event)));
			for (const waiter of waiting.filter((entry) => entry.event === event.event)) waiter.resolve();
		},
		now,
		appOrigin: OWN_ORIGIN,
	});
	const recorded = (event: string) =>
		new Promise<void>((resolve) => {
			waiting.push({ event, resolve: () => resolve() });
		});
	return { trace, events, recorded };
}

const signedIn: RequestHandler = (req, _res, next) => {
	Object.assign(req, { requestContext: { requestId: "gw-request-1" } });
	req.userId = READER;
	next();
};

const pass: RequestHandler = (_req, _res, next) => {
	next();
};

describe("initGmailOAuthTrace", () => {
	it("records the request it received and how it finished, correlated by one trace id", async () => {
		let nowMs = NOW_MS;
		const { trace, events } = recordingTrace(() => new Date(nowMs));
		const app = express();
		app.post("/connect", signedIn, trace.begin("connect"), trace.guard({ stage: "requireAuth", handler: pass }), (req, res) => {
			trace.enter(req, "issue-state");
			trace.record(req, {
				event: "gmail.oauth.state.issued",
				level: "INFO",
				issuedStateFingerprint: "f".repeat(64),
				previousCookie: toGmailOAuthStateInspection({ kind: "absent" }),
				intentKind: "connect",
			});
			trace.enter(req, "exchange");
			trace.fail(req, "exchange-failed");
			nowMs += 42;
			res.redirect(303, "/newsletters?error=oauth_exchange");
		});

		const response = await request(app).post("/connect");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters?error=oauth_exchange");
		const correlation = { route: "connect", traceId: expect.stringMatching(UUID), requestId: "gw-request-1", userId: READER };
		expect(events).toEqual([
			{ ...correlation, event: "gmail.oauth.request.received", level: "INFO", method: "POST", hxRequest: false },
			{
				...correlation,
				event: "gmail.oauth.state.issued",
				level: "INFO",
				issuedStateFingerprint: "f".repeat(64),
				previousCookie: { present: false },
				intentKind: "connect",
			},
			{
				...correlation,
				event: "gmail.oauth.request.completed",
				level: "ERROR",
				completion: "finished",
				status: 303,
				stage: "exchange",
				failureReason: "exchange-failed",
				redirect: "integrations",
				outcome: "oauth_exchange",
				durationMs: 42,
			},
		]);
		expect(new Set(events.map((event) => event.traceId)).size).toBe(1);
	});

	it("names the guard that answered the request", async () => {
		const { trace, events } = recordingTrace(() => new Date(NOW_MS));
		const app = express();
		const sendToLogin: RequestHandler = (_req, res) => {
			res.redirect(303, "/login");
		};
		app.get(
			"/callback",
			trace.begin("callback"),
			trace.guard({ stage: "returnSignedOutReader", handler: sendToLogin }),
			trace.guard({ stage: "requireAuth", handler: pass }),
		);

		await request(app).get("/callback");

		expect(events.at(-1)).toEqual({
			route: "callback",
			traceId: expect.stringMatching(UUID),
			requestId: undefined,
			userId: undefined,
			event: "gmail.oauth.request.completed",
			level: "INFO",
			completion: "finished",
			status: 303,
			stage: "returnSignedOutReader",
			failureReason: undefined,
			redirect: "login",
			outcome: undefined,
			durationMs: 0,
		});
	});

	it.each([
		["Google's consent screen", "https://accounts.google.com/o/oauth2/v2/auth?error=oauth_state", "google-authorize", undefined],
		["an unparsable target", "http://[", "other", undefined],
		["another origin", "https://elsewhere.example/newsletters?error=oauth_state", "other", undefined],
		["a protocol-relative origin", "//elsewhere.example/newsletters?error=oauth_state", "other", undefined],
		["the sign-in page", "/login?return=%2Fnewsletters%3Ferror%3Doauth_signed_out", "login", undefined],
		["the Gmail page with its notice", "/newsletters/gmail?notice=connected&search=dan", "gmail", "connected"],
		["the integrations page with its error", "/newsletters?error=oauth_state", "integrations", "oauth_state"],
		["an absolute link to our own integrations page", `${OWN_ORIGIN}/newsletters?error=oauth_scope`, "integrations", "oauth_scope"],
		["a redirect carrying both an error and a notice", "/newsletters?error=oauth_state&notice=gmail_disconnected", "integrations", "oauth_state"],
		["an error that is not a code", "/newsletters?error=Reader%40example.com", "integrations", undefined],
		["an overlong notice", `/newsletters/gmail?notice=${"a".repeat(65)}`, "gmail", undefined],
		["an empty notice", "/newsletters/gmail?notice=", "gmail", undefined],
		["another page of ours", "/queue?inactive=1", "other", undefined],
		["another page of ours with a notice", "/newsletters/gmail/senders?notice=import_started", "other", "import_started"],
	])("classifies a Location sending the reader to %s", async (_label, target, redirect, outcome) => {
		const { trace, events } = recordingTrace(() => new Date(NOW_MS));
		const app = express();
		app.get("/callback", trace.begin("callback"), (_req, res) => {
			res.status(303).set("Location", target).end();
		});

		const response = await request(app).get("/callback");

		expect(response.headers.location).toBe(target);
		expect(events.at(-1)).toEqual({
			route: "callback",
			traceId: expect.stringMatching(UUID),
			requestId: undefined,
			userId: undefined,
			event: "gmail.oauth.request.completed",
			level: "INFO",
			completion: "finished",
			status: 303,
			stage: "received",
			failureReason: undefined,
			redirect,
			outcome,
			durationMs: 0,
		});
	});

	it.each([
		["Google's consent screen", "https://accounts.google.com/o/oauth2/v2/auth?state=signed", "google-authorize", undefined],
		["the integrations page with its error", "/newsletters?error=oauth_state", "integrations", "oauth_state"],
		["the Gmail page with its notice", "/newsletters/gmail?notice=connected", "gmail", "connected"],
		["another origin", "https://elsewhere.example/newsletters?error=oauth_state", "other", undefined],
	])("classifies an HX-Redirect sending an htmx client to %s", async (_label, target, redirect, outcome) => {
		const { trace, events } = recordingTrace(() => new Date(NOW_MS));
		const app = express();
		app.post("/connect", trace.begin("connect"), (_req, res) => {
			res.status(200).set("HX-Redirect", target).end();
		});

		const response = await request(app).post("/connect").set("HX-Request", "true");

		expect(response.headers["hx-redirect"]).toBe(target);
		expect(events.at(-1)).toEqual({
			route: "connect",
			traceId: expect.stringMatching(UUID),
			requestId: undefined,
			userId: undefined,
			event: "gmail.oauth.request.completed",
			level: "INFO",
			completion: "finished",
			status: 200,
			stage: "received",
			failureReason: undefined,
			redirect,
			outcome,
			durationMs: 0,
		});
	});

	it.each([
		["metadata-scope-not-granted", "INFO"],
		["scope-not-granted", "INFO"],
		["no-refresh-token", "ERROR"],
		["exchange-failed", "ERROR"],
		["reauth-required", "ERROR"],
		["rejected", "ERROR"],
		["unavailable", "ERROR"],
	] as const)("records a request that failed for %s at the %s level", async (failureReason, level) => {
		const { trace, events } = recordingTrace(() => new Date(NOW_MS));
		const app = express();
		app.get("/callback", trace.begin("callback"), (req, res) => {
			trace.enter(req, "exchange");
			trace.fail(req, failureReason);
			res.redirect(303, "/newsletters?error=oauth_exchange");
		});

		await request(app).get("/callback");

		expect(events.at(-1)).toEqual({
			route: "callback",
			traceId: expect.stringMatching(UUID),
			requestId: undefined,
			userId: undefined,
			event: "gmail.oauth.request.completed",
			level,
			completion: "finished",
			status: 303,
			stage: "exchange",
			failureReason,
			redirect: "integrations",
			outcome: "oauth_exchange",
			durationMs: 0,
		});
	});

	it("reads an htmx client's redirect from HX-Redirect", async () => {
		const { trace, events } = recordingTrace(() => new Date(NOW_MS));
		const app = express();
		app.post("/connect", trace.begin("connect"), (req, res) => {
			trace.enter(req, "done");
			res.set("HX-Redirect", "https://accounts.google.com/o/oauth2/v2/auth?state=secret");
			res.status(200).send("");
		});

		await request(app).post("/connect").set("HX-Request", "true");

		expect(events).toMatchObject([
			{ event: "gmail.oauth.request.received", hxRequest: true },
			{ event: "gmail.oauth.request.completed", status: 200, stage: "done", redirect: "google-authorize" },
		]);
		expect(JSON.stringify(events)).not.toContain("secret");
	});

	it("records a server failure at the ERROR level and a rendered page without a redirect", async () => {
		const { trace, events } = recordingTrace(() => new Date(NOW_MS));
		const app = express();
		app.get("/failing", trace.begin("callback"), (req, res) => {
			trace.enter(req, "reconnect");
			res.status(503).send("unavailable");
		});
		app.get("/locked", trace.begin("callback"), (_req, res) => {
			res.status(200).send("locked");
		});

		await request(app).get("/failing");
		await request(app).get("/locked");

		const completion = {
			route: "callback",
			traceId: expect.stringMatching(UUID),
			requestId: undefined,
			userId: undefined,
			event: "gmail.oauth.request.completed",
			completion: "finished",
			failureReason: undefined,
			redirect: undefined,
			outcome: undefined,
			durationMs: 0,
		};
		expect(events.filter((event) => event.event === "gmail.oauth.request.completed")).toEqual([
			{ ...completion, level: "ERROR", status: 503, stage: "reconnect" },
			{ ...completion, level: "INFO", status: 200, stage: "received" },
		]);
	});

	it("records exactly one aborted completion when the connection closes before the response finishes", async () => {
		const { trace, events, recorded } = recordingTrace(() => new Date(NOW_MS));
		const app = express();
		app.get("/callback", trace.begin("callback"), (req) => {
			trace.enter(req, "exchange");
			req.socket.destroy();
		});
		const completed = recorded("gmail.oauth.request.completed");

		await assert.rejects(async () => {
			await request(app).get("/callback");
		});
		await completed;
		await new Promise((resolve) => setImmediate(resolve));

		expect(events.filter((event) => event.event === "gmail.oauth.request.completed")).toMatchObject([
			{ completion: "aborted", level: "INFO", status: 200, stage: "exchange" },
		]);
	});

	it("lets the request through untraced when the clock fails while it is received", async () => {
		const { trace, events } = recordingTrace(() => {
			throw new Error("clock unavailable");
		});
		const app = express();
		app.get("/callback", trace.begin("callback"), trace.guard({ stage: "requireAuth", handler: pass }), (req, res) => {
			trace.enter(req, "exchange");
			trace.fail(req, "no-refresh-token");
			trace.record(req, {
				event: "gmail.oauth.state.issued",
				level: "INFO",
				issuedStateFingerprint: "f".repeat(64),
				previousCookie: toGmailOAuthStateInspection({ kind: "absent" }),
				intentKind: "connect",
			});
			res.redirect(303, "/newsletters/gmail?notice=connected");
		});

		const response = await request(app).get("/callback");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters/gmail?notice=connected");
		expect(events).toEqual([]);
	});

	it("keeps the response intact when the clock fails while the completion is recorded", async () => {
		let reads = 0;
		const { trace, events } = recordingTrace(() => {
			reads += 1;
			if (reads > 1) throw new Error("clock unavailable");
			return new Date(NOW_MS);
		});
		const app = express();
		app.get("/callback", trace.begin("callback"), (_req, res) => {
			res.redirect(303, "/newsletters?error=oauth_state");
		});

		const response = await request(app).get("/callback");

		expect(response.status).toBe(303);
		expect(response.headers.location).toBe("/newsletters?error=oauth_state");
		expect(events.map((event) => event.event)).toEqual(["gmail.oauth.request.received"]);
	});
});
