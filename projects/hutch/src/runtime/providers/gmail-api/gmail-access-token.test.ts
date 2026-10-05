import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import type {
	GmailHttpAttempt,
	GmailHttpResponseHeaders,
	ObserveGmailHttpAttempt,
} from "@packages/provider-contracts/gmail-history";
import { initInMemoryGmailCredentials } from "@packages/test-fixtures/providers/gmail-credentials";
import { GMAIL_READONLY_SCOPE } from "@packages/provider-contracts/gmail-oauth";
import { initGmailAccessToken, initGmailReadonlyAccessToken } from "./gmail-access-token";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const NO_HEADERS: GmailHttpResponseHeaders = {
	contentType: undefined,
	declaredContentLength: undefined,
	contentEncoding: undefined,
	date: undefined,
	retryAfter: undefined,
	googRequestId: undefined,
	guploaderUploadId: undefined,
	cloudTraceContext: undefined,
};

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

function erroredBody(error: Error): Response {
	return new Response(
		new ReadableStream({
			start(controller) {
				controller.error(error);
			},
		}),
		{ status: 200 },
	);
}

function makeHarness(responses: (Response | Error)[]) {
	let clock = Date.parse("2026-08-27T00:00:00.000Z");
	const requests: URLSearchParams[] = [];
	const sent: { href: string; method: string | undefined; contentType: string | null; body: string }[] = [];
	const credentials = initInMemoryGmailCredentials({ now: () => new Date(clock) });

	const infoLines: unknown[][] = [];
	const errorLines: unknown[][] = [];
	const logger: HutchLogger = {
		info: (...args) => { infoLines.push(args); },
		error: (...args) => { errorLines.push(args); },
		warn: noopLogger.warn,
		debug: noopLogger.debug,
	};

	const fetchFake: typeof globalThis.fetch = async (input, init) => {
		sent.push({
			href: String(input),
			method: init?.method,
			contentType: new Headers(init?.headers).get("Content-Type"),
			body: String(init?.body),
		});
		requests.push(new URLSearchParams(String(init?.body)));
		const next = responses.shift();
		assert(next, "the test must queue a response for every refresh");
		if (next instanceof Error) throw next;
		Object.defineProperty(next, "url", { value: TOKEN_ENDPOINT });
		return next;
	};

	const attempts: GmailHttpAttempt[] = [];
	const observe: ObserveGmailHttpAttempt = (attempt) => {
		attempts.push(attempt);
	};

	const deps = {
		clientId: "client-id",
		clientSecret: "client-secret",
		credentials,
		fetch: fetchFake,
		now: () => {
			const current = new Date(clock);
			clock += 5;
			return current;
		},
		logger,
	};
	const accessToken = initGmailAccessToken(deps);

	return {
		deps,
		accessToken,
		requests,
		sent,
		credentials,
		infoLines,
		errorLines,
		attempts,
		observe,
		advanceTo: (iso: string) => {
			clock = Date.parse(iso);
		},
	};
}

describe("initGmailAccessToken", () => {
	it("refreshes once and serves the cached token until it nears expiry", async () => {
		const harness = makeHarness([json(200, { access_token: "at-1", expires_in: 3600 })]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const first = await harness.accessToken({ userId: USER, forceRefresh: false });
		harness.advanceTo("2026-08-27T00:30:00.000Z");
		const second = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(first, { ok: true, value: "at-1" });
		assert.deepEqual(second, { ok: true, value: "at-1" });
		assert.equal(harness.requests.length, 1);
		assert.equal(harness.requests[0].get("grant_type"), "refresh_token");
		assert.equal(harness.requests[0].get("refresh_token"), "refresh-1");
	});

	it("refreshes again a minute before the token would expire", async () => {
		const harness = makeHarness([
			json(200, { access_token: "at-1", expires_in: 3600 }),
			json(200, { access_token: "at-2", expires_in: 3600 }),
		]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});
		await harness.accessToken({ userId: USER, forceRefresh: false });

		harness.advanceTo("2026-08-27T00:59:30.000Z");
		const refreshed = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(refreshed, { ok: true, value: "at-2" });
		assert.equal(harness.requests.length, 2);
	});

	it("bypasses the cache when the caller saw a 401 from Gmail", async () => {
		const harness = makeHarness([
			json(200, { access_token: "at-1", expires_in: 3600 }),
			json(200, { access_token: "at-2", expires_in: 3600 }),
		]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});
		await harness.accessToken({ userId: USER, forceRefresh: false });

		const forced = await harness.accessToken({ userId: USER, forceRefresh: true });

		assert.deepEqual(forced, { ok: true, value: "at-2" });
		assert.equal(harness.requests.length, 2);
	});

	it("asks the user to reconnect when there is no stored refresh token", async () => {
		const harness = makeHarness([]);

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
		assert.equal(harness.requests.length, 0);
	});

	it("replaces a cached access token immediately after the saved grant changes", async () => {
		const harness = makeHarness([
			json(200, { access_token: "old-scope-token", expires_in: 3600 }),
			json(200, { access_token: "new-scope-token", expires_in: 3600 }),
		]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "old-grant", grantedScope: SCOPE });
		await harness.accessToken({ userId: USER, forceRefresh: false });
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "new-grant", grantedScope: `${SCOPE} https://www.googleapis.com/auth/gmail.metadata` });

		assert.deepEqual(await harness.accessToken({ userId: USER, forceRefresh: false }), { ok: true, value: "new-scope-token" });
		assert.equal(harness.requests[1].get("refresh_token"), "new-grant");

		await harness.credentials.deleteCredentials(USER);
		assert.deepEqual(await harness.accessToken({ userId: USER, forceRefresh: false }), { ok: false, reason: "reauth-required" });
	});

	it("asks the user to reconnect and logs the reason when Google reports invalid_grant", async () => {
		const harness = makeHarness([
			json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
		]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
		assert.deepEqual(harness.infoLines, [
			[
				"[gmail-access-token] refresh token rejected",
				{ userId: USER, status: 400, errorDescription: "Token has been expired or revoked." },
			],
		]);
		assert.deepEqual(harness.errorLines, []);
	});

	it("asks the user to reconnect and logs our client's error when Google refuses on invalid_client", async () => {
		const harness = makeHarness([
			json(401, { error: "invalid_client", error_description: "The OAuth client was not found." }),
		]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
		assert.equal(harness.errorLines.length, 1);
		assert.equal(harness.errorLines[0].length, 1);
		assert.deepEqual(JSON.parse(String(harness.errorLines[0][0])), {
			level: "ERROR",
			message: "[gmail-access-token] token endpoint refused our client",
			userId: USER,
			status: 401,
			error: "invalid_client",
			errorDescription: "The OAuth client was not found.",
		});
		assert.deepEqual(harness.infoLines, []);
	});

	it("asks the user to reconnect and logs the refusal when a 400 carries no error body", async () => {
		const harness = makeHarness([json(400, {})]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
		assert.deepEqual(JSON.parse(String(harness.errorLines[0][0])), {
			level: "ERROR",
			message: "[gmail-access-token] token endpoint refused our client",
			userId: USER,
			status: 400,
		});
	});

	it("asks the user to reconnect and logs the refusal when a 401 body is not JSON", async () => {
		const harness = makeHarness([new Response("<html>Unauthorized</html>", { status: 401 })]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "reauth-required" });
		assert.deepEqual(JSON.parse(String(harness.errorLines[0][0])), {
			level: "ERROR",
			message: "[gmail-access-token] token endpoint refused our client",
			userId: USER,
			status: 401,
		});
	});

	it("reports a Google outage as retryable", async () => {
		const harness = makeHarness([json(503, {})]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 503 });
	});

	it("reports a token response it cannot read as retryable", async () => {
		const harness = makeHarness([json(200, { access_token: "at-1" })]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 200 });
	});

	it("throws when Google answers a refresh with an empty success", async () => {
		const harness = makeHarness([new Response(null, { status: 204 })]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });

		await assert.rejects(harness.accessToken({ userId: USER, forceRefresh: false }), SyntaxError);
	});
});

describe("initGmailReadonlyAccessToken", () => {
	it("asks Google for a token narrowed to read-only Gmail access, recording the refresh", async () => {
		const body = { access_token: "readonly-1", expires_in: 3600 };
		const harness = makeHarness([json(200, body)]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: `${SCOPE} ${GMAIL_READONLY_SCOPE}` });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), { ok: true, value: "readonly-1" });
		assert.equal(harness.requests[0].get("scope"), GMAIL_READONLY_SCOPE);
		assert.equal(harness.requests[0].get("refresh_token"), "refresh-1");
		assert.deepEqual(harness.sent, [
			{
				href: TOKEN_ENDPOINT,
				method: "POST",
				contentType: "application/x-www-form-urlencoded",
				body: "client_id=client-id&client_secret=client-secret&refresh_token=refresh-1&grant_type=refresh_token&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly",
			},
		]);
		assert.deepEqual(harness.attempts, [
			{
				operation: "oauth.refresh",
				attempt: 1,
				request: { operation: "oauth.refresh", forceRefresh: false },
				requestedEndpoint: "oauth.token",
				durationMs: 5,
				response: {
					status: 200,
					redirected: false,
					finalEndpoint: "oauth.token",
					finalOriginExpected: true,
					bodyNull: false,
					headers: { ...NO_HEADERS, contentType: "application/json" },
					bodyReads: [
						{
							source: "response",
							outcome: "valid",
							measuredBytes: Buffer.byteLength(JSON.stringify(body)),
							errorName: undefined,
							fields: { accessTokenPresent: true, expiresInPresent: true },
						},
					],
				},
				transportFailure: undefined,
				classification: "ok",
			},
		]);
	});

	it("serves a cached token without calling Google or recording an attempt, and records a forced refresh", async () => {
		const harness = makeHarness([
			json(200, { access_token: "readonly-1", expires_in: 3600 }),
			json(200, { access_token: "readonly-2", expires_in: 3600 }),
		]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: GMAIL_READONLY_SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe });
		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), { ok: true, value: "readonly-1" });
		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: true, observe: harness.observe }), { ok: true, value: "readonly-2" });

		assert.equal(harness.requests.length, 2);
		assert.deepEqual(
			harness.attempts.map(({ request, classification }) => ({ request, classification })),
			[
				{ request: { operation: "oauth.refresh", forceRefresh: false }, classification: "ok" },
				{ request: { operation: "oauth.refresh", forceRefresh: true }, classification: "ok" },
			],
		);
	});

	it("keeps its own cache apart from the granted-scope token for the same user", async () => {
		const harness = makeHarness([
			json(200, { access_token: "granted-1", expires_in: 3600 }),
			json(200, { access_token: "readonly-1", expires_in: 3600 }),
		]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: `${SCOPE} ${GMAIL_READONLY_SCOPE}` });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		assert.deepEqual(await harness.accessToken({ userId: USER, forceRefresh: false }), { ok: true, value: "granted-1" });
		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), { ok: true, value: "readonly-1" });
		assert.deepEqual(await harness.accessToken({ userId: USER, forceRefresh: false }), { ok: true, value: "granted-1" });
		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), { ok: true, value: "readonly-1" });
		assert.equal(harness.requests.length, 2);
		assert.equal(harness.requests[0].get("scope"), null);
		assert.equal(harness.requests[1].get("scope"), GMAIL_READONLY_SCOPE);
		assert.equal(harness.attempts.length, 1);
	});

	it("asks for read-only permission, logging it as expected, when the grant lacks the read-only scope", async () => {
		const body = { error: "invalid_scope", error_description: "Bad Request" };
		const harness = makeHarness([json(400, body)]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		const result = await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe });

		assert.deepEqual(result, { ok: false, reason: "readonly-permission-required" });
		assert.deepEqual(harness.infoLines, [
			["[gmail-access-token] requested scope not granted", { userId: USER, status: 400, errorDescription: "Bad Request" }],
		]);
		assert.deepEqual(harness.errorLines, []);
		assert.equal(harness.attempts[0].classification, "readonly-permission-required");
		assert.deepEqual(harness.attempts[0].response?.bodyReads, [
			{
				source: "response",
				outcome: "valid",
				measuredBytes: Buffer.byteLength(JSON.stringify(body)),
				errorName: undefined,
				fields: { errorPresent: true, errorDescriptionPresent: true },
			},
		]);
	});

	it("still asks the user to reconnect when Google revoked the refresh token itself", async () => {
		const harness = makeHarness([json(400, { error: "invalid_grant" })]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), { ok: false, reason: "reauth-required" });
		assert.equal(harness.attempts[0].classification, "reauth-required");
		assert.deepEqual(harness.attempts[0].response?.bodyReads[0].fields, { errorPresent: true, errorDescriptionPresent: false });
	});

	it("records every other token endpoint refusal as a reconnect, with how far its body could be read", async () => {
		const notJson = "<html>Unauthorized</html>";
		for (const [reply, read] of [
			[
				json(401, { error: "invalid_client" }),
				{ outcome: "valid", measuredBytes: Buffer.byteLength(JSON.stringify({ error: "invalid_client" })), errorName: undefined, fields: { errorPresent: true, errorDescriptionPresent: false } },
			],
			[
				json(400, {}),
				{ outcome: "schema-rejected", measuredBytes: 2, errorName: undefined, fields: { errorPresent: false, errorDescriptionPresent: false } },
			],
			[
				new Response(notJson, { status: 401 }),
				{ outcome: "json-decode-failed", measuredBytes: notJson.length, errorName: "SyntaxError", fields: {} },
			],
		] as const) {
			const harness = makeHarness([reply]);
			await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
			const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

			assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), { ok: false, reason: "reauth-required" });
			assert.equal(harness.errorLines.length, 1);
			assert.equal(harness.attempts[0].classification, "reauth-required");
			assert.deepEqual(harness.attempts[0].response?.bodyReads, [{ source: "response", ...read }]);
		}
	});

	it("records an outage without reading its body", async () => {
		const outage = json(503, { error: "backend down" });
		const harness = makeHarness([outage]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), {
			ok: false,
			reason: "unavailable",
			status: 503,
		});
		assert.equal(outage.bodyUsed, false);
		assert.equal(harness.attempts[0].classification, "unavailable");
		assert.deepEqual(harness.attempts[0].response?.bodyReads, []);
	});

	it("records a token response it cannot read as unavailable", async () => {
		const harness = makeHarness([json(200, { access_token: "readonly-1" })]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		assert.deepEqual(await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), {
			ok: false,
			reason: "unavailable",
			status: 200,
		});
		assert.equal(harness.attempts[0].classification, "unavailable");
		assert.deepEqual(harness.attempts[0].response?.bodyReads, [
			{
				source: "response",
				outcome: "schema-rejected",
				measuredBytes: Buffer.byteLength(JSON.stringify({ access_token: "readonly-1" })),
				errorName: undefined,
				fields: { accessTokenPresent: true, expiresInPresent: false },
			},
		]);
	});

	it("still throws on an empty successful refresh, recording it as an exception", async () => {
		const harness = makeHarness([new Response(null, { status: 204 })]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		await assert.rejects(readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), SyntaxError);

		assert.equal(harness.attempts[0].classification, "exception");
		assert.equal(harness.attempts[0].response?.status, 204);
		assert.equal(harness.attempts[0].response?.bodyNull, true);
		assert.deepEqual(harness.attempts[0].response?.bodyReads, [
			{ source: "response", outcome: "json-decode-failed", measuredBytes: 0, errorName: "SyntaxError", fields: {} },
		]);
	});

	it("still throws the read failure when a successful refresh body cannot be read, recording it as an exception", async () => {
		const failure = new RangeError("stream failed");
		const harness = makeHarness([erroredBody(failure)]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		await assert.rejects(readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe }), (error) => error === failure);

		assert.equal(harness.attempts[0].classification, "exception");
		assert.deepEqual(harness.attempts[0].response?.bodyReads, [
			{ source: "response", outcome: "body-read-failed", measuredBytes: undefined, errorName: "RangeError", fields: {} },
		]);
	});

	it("rethrows a transport failure after recording it", async () => {
		const failure = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
		const harness = makeHarness([failure]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken(harness.deps);

		await assert.rejects(readonlyToken({ userId: USER, forceRefresh: true, observe: harness.observe }), (error) => error === failure);

		assert.deepEqual(harness.attempts, [
			{
				operation: "oauth.refresh",
				attempt: 1,
				request: { operation: "oauth.refresh", forceRefresh: true },
				requestedEndpoint: "oauth.token",
				durationMs: 5,
				response: undefined,
				transportFailure: { errorName: "TypeError", errorCode: "ECONNRESET" },
				classification: "transport-failed",
			},
		]);
	});

	it("leaves results, requests and the cache unchanged when the observer throws", async () => {
		async function run(observe: ObserveGmailHttpAttempt) {
			const harness = makeHarness([
				json(400, { error: "invalid_scope" }),
				json(200, { access_token: "readonly-1", expires_in: 3600 }),
			]);
			await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-1", grantedScope: SCOPE });
			const readonlyToken = initGmailReadonlyAccessToken(harness.deps);
			const results = [
				await readonlyToken({ userId: USER, forceRefresh: false, observe }),
				await readonlyToken({ userId: USER, forceRefresh: false, observe }),
				await readonlyToken({ userId: USER, forceRefresh: false, observe }),
			];
			return { results, requests: harness.requests.map(String), infoLines: harness.infoLines };
		}

		const recorded: GmailHttpAttempt[] = [];
		const observed = await run((attempt) => {
			recorded.push(attempt);
		});
		const unobserved = await run(() => {
			throw new Error("observer broke");
		});

		assert.deepEqual(unobserved, observed);
		assert.equal(observed.requests.length, 2);
		assert.equal(recorded.length, 2);
	});

	it("never records the client secret, refresh token, access token or Google's error text", async () => {
		const harness = makeHarness([
			json(400, { error: "invalid_grant", error_description: "Sentinel grant revoked by sentinel@example.com" }),
			json(200, { access_token: "access-sentinel", expires_in: 3600, scope: "sentinel-scope" }),
			new TypeError("connect sentinel failed", { cause: { code: "sentinel" } }),
		]);
		await harness.credentials.saveCredentials({ userId: USER, refreshToken: "refresh-sentinel", grantedScope: SCOPE });
		const readonlyToken = initGmailReadonlyAccessToken({ ...harness.deps, clientSecret: "client-secret-sentinel" });

		await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe });
		await readonlyToken({ userId: USER, forceRefresh: false, observe: harness.observe });
		await assert.rejects(readonlyToken({ userId: USER, forceRefresh: true, observe: harness.observe }));

		assert.equal(harness.requests[0].get("client_secret"), "client-secret-sentinel");
		assert.deepEqual(
			harness.attempts.map(({ classification }) => classification),
			["reauth-required", "ok", "transport-failed"],
		);
		assert.equal(JSON.stringify(harness.attempts).toLowerCase().includes("sentinel"), false);
	});
});
