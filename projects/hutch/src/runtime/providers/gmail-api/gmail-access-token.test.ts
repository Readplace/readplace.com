import assert from "node:assert/strict";
import { UserIdSchema } from "@packages/domain/user";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import { initInMemoryGmailCredentials } from "@packages/test-fixtures/providers/gmail-credentials";
import { initGmailAccessToken } from "./gmail-access-token";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";

interface FakeResponse {
	status: number;
	body: unknown;
}

function makeHarness(responses: FakeResponse[]) {
	let clock = new Date("2026-08-27T00:00:00.000Z");
	const requests: URLSearchParams[] = [];
	const credentials = initInMemoryGmailCredentials({ now: () => clock });

	const infoLines: unknown[][] = [];
	const errorLines: unknown[][] = [];
	const logger: HutchLogger = {
		info: (...args) => { infoLines.push(args); },
		error: (...args) => { errorLines.push(args); },
		warn: noopLogger.warn,
		debug: noopLogger.debug,
	};

	const fetchFake = (async (_url: string, init?: { body?: string }) => {
		requests.push(new URLSearchParams(init?.body));
		const next = responses.shift();
		assert(next, "the test must queue a response for every refresh");
		return {
			ok: next.status >= 200 && next.status < 300,
			status: next.status,
			json: async () => next.body,
		};
	}) as unknown as typeof globalThis.fetch;

	const accessToken = initGmailAccessToken({
		clientId: "client-id",
		clientSecret: "client-secret",
		credentials,
		fetch: fetchFake,
		now: () => clock,
		logger,
	});

	return {
		accessToken,
		requests,
		credentials,
		infoLines,
		errorLines,
		advanceTo: (iso: string) => {
			clock = new Date(iso);
		},
	};
}

describe("initGmailAccessToken", () => {
	it("refreshes once and serves the cached token until it nears expiry", async () => {
		const harness = makeHarness([{ status: 200, body: { access_token: "at-1", expires_in: 3600 } }]);
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
			{ status: 200, body: { access_token: "at-1", expires_in: 3600 } },
			{ status: 200, body: { access_token: "at-2", expires_in: 3600 } },
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
			{ status: 200, body: { access_token: "at-1", expires_in: 3600 } },
			{ status: 200, body: { access_token: "at-2", expires_in: 3600 } },
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
			{ status: 200, body: { access_token: "old-scope-token", expires_in: 3600 } },
			{ status: 200, body: { access_token: "new-scope-token", expires_in: 3600 } },
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
			{ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
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

	it("returns retryable and logs our client's error when Google refuses on invalid_client", async () => {
		const harness = makeHarness([
			{ status: 401, body: { error: "invalid_client", error_description: "The OAuth client was not found." } },
		]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 401 });
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

	it("returns retryable and logs our client's error when a 400 carries no error body", async () => {
		const harness = makeHarness([{ status: 400, body: {} }]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 400 });
		assert.deepEqual(JSON.parse(String(harness.errorLines[0][0])), {
			level: "ERROR",
			message: "[gmail-access-token] token endpoint refused our client",
			userId: USER,
			status: 400,
		});
	});

	it("reports a Google outage as retryable", async () => {
		const harness = makeHarness([{ status: 503, body: {} }]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 503 });
	});

	it("reports a token response it cannot read as retryable", async () => {
		const harness = makeHarness([{ status: 200, body: { access_token: "at-1" } }]);
		await harness.credentials.saveCredentials({
			userId: USER,
			refreshToken: "refresh-1",
			grantedScope: SCOPE,
		});

		const result = await harness.accessToken({ userId: USER, forceRefresh: false });

		assert.deepEqual(result, { ok: false, reason: "unavailable", status: 200 });
	});
});
