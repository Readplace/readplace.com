import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailMessageIdSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { HutchLogger, noopLogger } from "@packages/hutch-logger";
import type {
	GetGmailReadonlyAccessToken,
	GmailHistory,
	GmailHistoryResult,
	GmailHttpAttempt,
	GmailHttpRequestSettings,
	GmailHttpResponseHeaders,
	ObserveGmailHttpAttempt,
} from "@packages/provider-contracts/gmail-history";
import { initInMemoryGmailCredentials } from "@packages/test-fixtures/providers/gmail-credentials";
import { initGmailReadonlyAccessToken } from "./gmail-access-token";
import { initGmailHistory } from "./gmail-history";

const USER = UserIdSchema.parse("reader");
const SENDER = ForwardableSenderSchema.parse("news@example.com");
const WINDOW = { start: "2026-08-31T00:00:00.000Z", end: "2026-09-30T00:00:00.500Z" };
const MESSAGE_ID = GmailMessageIdSchema.parse("18c2f0a1b2");
const RAW_MAIL = "From: News <news@example.com>\r\nMessage-ID: <m-1@example.com>\r\n\r\nHello";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

const LISTING_REQUEST: GmailHttpRequestSettings = {
	operation: "messages.list",
	fieldMask: "messages(id),nextPageToken",
	pageSize: 25,
	includeSpamTrash: false,
	pageTokenPresent: false,
};

const RAW_MESSAGE_REQUEST: GmailHttpRequestSettings = {
	operation: "messages.get",
	fieldMask: "raw,internalDate,labelIds",
	format: "RAW",
};

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

const PROVIDER_IDS = {
	"x-goog-request-id": "req_ABC-123",
	"x-guploader-uploadid": "AHMx-upload_42",
	"x-cloud-trace-context": "105445aa7843bc8bf206b12000100000/1;o=1",
};

type Reply = { status: number; body?: unknown } | Response | Error;

function tickingClock(stepMs: number): () => Date {
	let clock = Date.parse("2026-10-05T00:00:00.000Z");
	return () => {
		const current = new Date(clock);
		clock += stepMs;
		return current;
	};
}

function reachedAt(input: { url: string; response: Response; redirected: boolean }): Response {
	Object.defineProperty(input.response, "url", { value: input.url });
	Object.defineProperty(input.response, "redirected", { value: input.redirected });
	return input.response;
}

function respond(input: { href: string; reply: Reply }): Response {
	const { reply } = input;
	if (reply instanceof Error) throw reply;
	if (reply instanceof Response) return reply;
	return reachedAt({
		url: input.href,
		redirected: false,
		response: new Response(reply.body === undefined ? "not json" : JSON.stringify(reply.body), {
			status: reply.status,
			statusText: `status ${reply.status}`,
		}),
	});
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

function outcomes(attempts: GmailHttpAttempt[]) {
	return attempts.map((attempt) => ({
		operation: attempt.operation,
		attempt: attempt.attempt,
		status: attempt.response?.status,
		classification: attempt.classification,
		bodyReads: attempt.response?.bodyReads,
	}));
}

function harness(reply: (url: URL) => Reply, tokens?: GmailHistoryResult<string>[]) {
	const requests: { href: string; url: URL; method: string | undefined; authorization: string | null }[] = [];
	const refreshes: boolean[] = [];
	const attempts: GmailHttpAttempt[] = [];
	const observe: ObserveGmailHttpAttempt = (attempt) => {
		attempts.push(attempt);
	};
	const history = initGmailHistory({
		accessToken: async ({ forceRefresh }) => {
			refreshes.push(forceRefresh);
			if (tokens !== undefined) {
				const token = tokens.shift();
				assert(token, "a token response must be queued");
				return token;
			}
			return { ok: true, value: forceRefresh ? "renewed" : "cached" };
		},
		fetch: async (input, init) => {
			const href = String(input);
			const url = new URL(href);
			requests.push({ href, url, method: init?.method, authorization: new Headers(init?.headers).get("Authorization") });
			return respond({ href, reply: reply(url) });
		},
		now: tickingClock(7),
	});
	return { history, requests, refreshes, attempts, observe };
}

async function readonlyTokenProvider(input: { refreshToken: string; clientSecret: string; replies: Response[] }) {
	const credentials = initInMemoryGmailCredentials({ now: () => new Date("2026-10-05T00:00:00.000Z") });
	await credentials.saveCredentials({ userId: USER, refreshToken: input.refreshToken, grantedScope: "https://www.googleapis.com/auth/gmail.readonly" });
	const sent: { href: string; method: string | undefined; body: string }[] = [];
	const accessToken: GetGmailReadonlyAccessToken = initGmailReadonlyAccessToken({
		clientId: "client-id",
		clientSecret: input.clientSecret,
		credentials,
		fetch: async (url, init) => {
			sent.push({ href: String(url), method: init?.method, body: String(init?.body) });
			const next = input.replies.shift();
			assert(next, "the test must queue a token response for every refresh");
			return reachedAt({ url: TOKEN_ENDPOINT, redirected: false, response: next });
		},
		now: tickingClock(3),
		logger: HutchLogger.from(noopLogger),
	});
	return { accessToken, sent };
}

function tokenReply(accessToken: string): Response {
	return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }), {
		status: 200,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

describe("initGmailHistory", () => {
	describe("listUnreadMessageIds", () => {
		it("asks Gmail for one page of the sender's unread mail inside the window, spam and trash excluded", async () => {
			const body = { messages: [{ id: "18c2f0a1b2" }, { id: "18c2f0a1b3" }], nextPageToken: "page-2" };
			const { history, requests, attempts, observe } = harness(() => ({ status: 200, body }));

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: "page-1", observe });

			assert.deepEqual(result, { ok: true, value: { messageIds: ["18c2f0a1b2", "18c2f0a1b3"], nextPageToken: "page-2" } });
			const { url, authorization } = requests[0];
			assert.equal(url.pathname, "/gmail/v1/users/me/messages");
			assert.equal(url.searchParams.get("q"), "from:news@example.com is:unread after:1788134400 before:1790726400");
			assert.equal(url.searchParams.get("maxResults"), "25");
			assert.equal(url.searchParams.get("includeSpamTrash"), "false");
			assert.equal(url.searchParams.get("fields"), "messages(id),nextPageToken");
			assert.equal(url.searchParams.get("pageToken"), "page-1");
			assert.equal(authorization, "Bearer cached");
			assert.deepEqual(
				requests.map(({ href, method }) => ({ href, method })),
				[
					{
						href: "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from%3Anews%40example.com+is%3Aunread+after%3A1788134400+before%3A1790726400&maxResults=25&includeSpamTrash=false&fields=messages%28id%29%2CnextPageToken&pageToken=page-1",
						method: "GET",
					},
				],
			);
			assert.deepEqual(attempts, [
				{
					operation: "messages.list",
					attempt: 1,
					request: { ...LISTING_REQUEST, pageTokenPresent: true },
					requestedEndpoint: "gmail.messages.list",
					durationMs: 7,
					response: {
						status: 200,
						redirected: false,
						finalEndpoint: "gmail.messages.list",
						finalOriginExpected: true,
						bodyNull: false,
						headers: { ...NO_HEADERS, contentType: "text/plain" },
						bodyReads: [
							{
								source: "response",
								outcome: "valid",
								measuredBytes: Buffer.byteLength(JSON.stringify(body)),
								errorName: undefined,
								fields: { messagesPresent: true, messageCount: 2, nextPageTokenPresent: true },
							},
						],
					},
					transportFailure: undefined,
					classification: "ok",
				},
			]);
		});

		it("reports an empty last page when the sender has no unread mail", async () => {
			const { history, requests, attempts, observe } = harness(() => ({ status: 200, body: {} }));

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe });

			assert.deepEqual(result, { ok: true, value: { messageIds: [], nextPageToken: undefined } });
			assert.equal(requests[0].url.searchParams.has("pageToken"), false);
			assert.deepEqual(attempts[0].request, LISTING_REQUEST);
			assert.deepEqual(outcomes(attempts), [
				{
					operation: "messages.list",
					attempt: 1,
					status: 200,
					classification: "ok",
					bodyReads: [
						{
							source: "response",
							outcome: "valid",
							measuredBytes: 2,
							errorName: undefined,
							fields: { messagesPresent: false, messageCount: 0, nextPageTokenPresent: false },
						},
					],
				},
			]);
		});

		it("reports a listing it cannot read as retryable", async () => {
			for (const [body, fields] of [
				[{ messages: [{ id: "not/an/id" }] }, { messagesPresent: true, messageCount: 1, nextPageTokenPresent: false }],
				[null, { messagesPresent: false, messageCount: 0, nextPageTokenPresent: false }],
			] as const) {
				const { history, attempts, observe } = harness(() => ({ status: 200, body }));

				assert.deepEqual(
					await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe }),
					{ ok: false, reason: "unavailable", status: 200 },
				);
				assert.deepEqual(outcomes(attempts), [
					{
						operation: "messages.list",
						attempt: 1,
						status: 200,
						classification: "unavailable",
						bodyReads: [
							{
								source: "response",
								outcome: "schema-rejected",
								measuredBytes: Buffer.byteLength(JSON.stringify(body)),
								errorName: undefined,
								fields,
							},
						],
					},
				]);
			}
		});

		it("reports a native empty 204 listing as retryable", async () => {
			const { history, attempts, observe } = harness((url) =>
				reachedAt({ url: url.href, redirected: false, response: new Response(null, { status: 204 }) }),
			);

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe });

			assert.deepEqual(result, { ok: false, reason: "unavailable", status: 204 });
			assert.deepEqual(attempts[0].response, {
				status: 204,
				redirected: false,
				finalEndpoint: "gmail.messages.list",
				finalOriginExpected: true,
				bodyNull: true,
				headers: NO_HEADERS,
				bodyReads: [
					{ source: "response", outcome: "json-decode-failed", measuredBytes: 0, errorName: "SyntaxError", fields: {} },
				],
			});
			assert.equal(attempts[0].classification, "unavailable");
		});

		it("reports a listing body that is not JSON, or cannot be read, as retryable", async () => {
			for (const [reply, read] of [
				[
					new Response("{", { status: 200 }),
					{ source: "response", outcome: "json-decode-failed", measuredBytes: 1, errorName: "SyntaxError", fields: {} },
				],
				[
					erroredBody(new RangeError("stream failed")),
					{ source: "response", outcome: "body-read-failed", measuredBytes: undefined, errorName: "RangeError", fields: {} },
				],
			] as const) {
				const { history, attempts, observe } = harness((url) => reachedAt({ url: url.href, redirected: false, response: reply }));

				assert.deepEqual(
					await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe }),
					{ ok: false, reason: "unavailable", status: 200 },
				);
				assert.deepEqual(outcomes(attempts), [
					{ operation: "messages.list", attempt: 1, status: 200, classification: "unavailable", bodyReads: [read] },
				]);
			}
		});

		it("rethrows a transport failure after recording it", async () => {
			const failure = new TypeError("fetch failed", { cause: { code: "ECONNRESET" } });
			const { history, attempts, observe } = harness(() => failure);

			await assert.rejects(
				history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe }),
				(error) => error === failure,
			);

			assert.deepEqual(attempts, [
				{
					operation: "messages.list",
					attempt: 1,
					request: LISTING_REQUEST,
					requestedEndpoint: "gmail.messages.list",
					durationMs: 7,
					response: undefined,
					transportFailure: { errorName: "TypeError", errorCode: "ECONNRESET" },
					classification: "transport-failed",
				},
			]);
		});

		it("records a listing redirected to another origin without its address or provider ids", async () => {
			const html = "<html>Sign in to continue</html>";
			const { history, attempts, observe } = harness(() =>
				reachedAt({
					url: "https://accounts.google.com/ServiceLogin?continue=mail",
					redirected: true,
					response: new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...PROVIDER_IDS } }),
				}),
			);

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe });

			assert.deepEqual(result, { ok: false, reason: "unavailable", status: 200 });
			assert.deepEqual(attempts[0].response, {
				status: 200,
				redirected: true,
				finalEndpoint: "unexpected-origin",
				finalOriginExpected: false,
				bodyNull: false,
				headers: { ...NO_HEADERS, contentType: "text/html" },
				bodyReads: [
					{ source: "response", outcome: "json-decode-failed", measuredBytes: html.length, errorName: "SyntaxError", fields: {} },
				],
			});
		});
	});

	describe("fetchRawMessage", () => {
		it("returns the decoded RFC 822 bytes with the message's received time and labels", async () => {
			const raw = Buffer.from(RAW_MAIL).toString("base64url");
			const { history, requests, attempts, observe } = harness(() => ({
				status: 200,
				body: { raw, internalDate: "1759190400000", labelIds: ["UNREAD", "INBOX"] },
			}));

			const result = await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe });

			assert.deepEqual(result, {
				ok: true,
				value: { raw: Buffer.from(RAW_MAIL), internalDate: "2025-09-30T00:00:00.000Z", labelIds: ["UNREAD", "INBOX"] },
			});
			const { url } = requests[0];
			assert.equal(url.pathname, "/gmail/v1/users/me/messages/18c2f0a1b2");
			assert.equal(url.searchParams.get("format"), "RAW");
			assert.equal(url.searchParams.get("fields"), "raw,internalDate,labelIds");
			assert.deepEqual(
				requests.map(({ href, method, authorization }) => ({ href, method, authorization })),
				[
					{
						href: "https://gmail.googleapis.com/gmail/v1/users/me/messages/18c2f0a1b2?format=RAW&fields=raw%2CinternalDate%2ClabelIds",
						method: "GET",
						authorization: "Bearer cached",
					},
				],
			);
			assert.deepEqual(attempts[0].request, RAW_MESSAGE_REQUEST);
			assert.equal(attempts[0].requestedEndpoint, "gmail.messages.get");
			assert.equal(attempts[0].response?.finalEndpoint, "gmail.messages.get");
			assert.deepEqual(attempts[0].response?.bodyReads[0].fields, {
				rawPresent: true,
				rawLength: raw.length,
				internalDatePresent: true,
				labelCount: 2,
			});
			assert.equal(attempts[0].classification, "ok");
		});

		it("treats a message without labels as unlabelled", async () => {
			const { history, observe } = harness(() => ({ status: 200, body: { raw: "", internalDate: 0 } }));

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }), {
				ok: true,
				value: { raw: Buffer.alloc(0), internalDate: "1970-01-01T00:00:00.000Z", labelIds: [] },
			});
		});

		it("reports a message deleted since it was listed as not found, without reading the body", async () => {
			const notFound = new Response(JSON.stringify({ error: { message: "Not Found" } }), { status: 404 });
			const { history, attempts, observe } = harness((url) => reachedAt({ url: url.href, redirected: false, response: notFound }));

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }), { ok: true, value: { notFound: true } });
			assert.equal(notFound.bodyUsed, false);
			assert.deepEqual(outcomes(attempts), [
				{ operation: "messages.get", attempt: 1, status: 404, classification: "not-found", bodyReads: [] },
			]);
		});

		it("reports a native empty 204 message as retryable", async () => {
			const { history, attempts, observe } = harness((url) =>
				reachedAt({ url: url.href, redirected: false, response: new Response(null, { status: 204 }) }),
			);

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }), {
				ok: false,
				reason: "unavailable",
				status: 204,
			});
			assert.equal(attempts[0].response?.bodyNull, true);
			assert.deepEqual(outcomes(attempts), [
				{
					operation: "messages.get",
					attempt: 1,
					status: 204,
					classification: "unavailable",
					bodyReads: [
						{ source: "response", outcome: "json-decode-failed", measuredBytes: 0, errorName: "SyntaxError", fields: {} },
					],
				},
			]);
		});

		it("reports a message it cannot read as retryable", async () => {
			const { history, attempts, observe } = harness(() => ({ status: 200, body: { raw: 5, labelIds: "INBOX" } }));

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }), {
				ok: false,
				reason: "unavailable",
				status: 200,
			});
			assert.deepEqual(attempts[0].response?.bodyReads, [
				{
					source: "response",
					outcome: "schema-rejected",
					measuredBytes: Buffer.byteLength(JSON.stringify({ raw: 5, labelIds: "INBOX" })),
					errorName: undefined,
					fields: { rawPresent: true, rawLength: 0, internalDatePresent: false, labelCount: 0 },
				},
			]);
		});
	});

	describe("Gmail refusals", () => {
		it("renews the token once after a 401 and retries", async () => {
			let calls = 0;
			const refused = new Response("{}", { status: 401 });
			const { history, requests, refreshes, attempts, observe } = harness((url) => {
				calls += 1;
				return calls === 1 ? reachedAt({ url: url.href, redirected: false, response: refused }) : { status: 200, body: {} };
			});

			const result = await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe });

			assert.equal(result.ok, true);
			assert.deepEqual(refreshes, [false, true]);
			assert.equal(requests[1].authorization, "Bearer renewed");
			assert.equal(refused.bodyUsed, false);
			assert.deepEqual(
				attempts.map(({ attempt, durationMs, classification }) => ({ attempt, durationMs, classification })),
				[
					{ attempt: 1, durationMs: 7, classification: "token-refresh-retry" },
					{ attempt: 2, durationMs: 7, classification: "ok" },
				],
			);
			assert.deepEqual(attempts[0].response?.bodyReads, []);
		});

		it("renews through the read-only token provider, recording each refresh between the Gmail attempts", async () => {
			const tokens = await readonlyTokenProvider({
				refreshToken: "refresh-1",
				clientSecret: "client-secret",
				replies: [tokenReply("at-1"), tokenReply("at-2")],
			});
			let calls = 0;
			const requests: { href: string; authorization: string | null }[] = [];
			const attempts: GmailHttpAttempt[] = [];
			const history = initGmailHistory({
				accessToken: tokens.accessToken,
				fetch: async (input, init) => {
					calls += 1;
					requests.push({ href: String(input), authorization: new Headers(init?.headers).get("Authorization") });
					return reachedAt({
						url: String(input),
						redirected: false,
						response: new Response("{}", { status: calls === 1 ? 401 : 200 }),
					});
				},
				now: tickingClock(7),
			});

			const result = await history.listUnreadMessageIds({
				userId: USER,
				sender: SENDER,
				window: WINDOW,
				pageToken: undefined,
				observe: (attempt) => {
					attempts.push(attempt);
				},
			});

			assert.deepEqual(result, { ok: true, value: { messageIds: [], nextPageToken: undefined } });
			assert.deepEqual(
				requests.map(({ authorization }) => authorization),
				["Bearer at-1", "Bearer at-2"],
			);
			const readonlyRefresh =
				"client_id=client-id&client_secret=client-secret&refresh_token=refresh-1&grant_type=refresh_token&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgmail.readonly";
			assert.deepEqual(tokens.sent, [
				{ href: TOKEN_ENDPOINT, method: "POST", body: readonlyRefresh },
				{ href: TOKEN_ENDPOINT, method: "POST", body: readonlyRefresh },
			]);
			assert.deepEqual(
				attempts.map(({ operation, attempt, request, durationMs, classification, response }) => ({
					operation,
					attempt,
					request,
					durationMs,
					classification,
					finalEndpoint: response?.finalEndpoint,
				})),
				[
					{ operation: "oauth.refresh", attempt: 1, request: { operation: "oauth.refresh", forceRefresh: false }, durationMs: 3, classification: "ok", finalEndpoint: "oauth.token" },
					{ operation: "messages.list", attempt: 1, request: LISTING_REQUEST, durationMs: 7, classification: "token-refresh-retry", finalEndpoint: "gmail.messages.list" },
					{ operation: "oauth.refresh", attempt: 1, request: { operation: "oauth.refresh", forceRefresh: true }, durationMs: 3, classification: "ok", finalEndpoint: "oauth.token" },
					{ operation: "messages.list", attempt: 2, request: LISTING_REQUEST, durationMs: 7, classification: "ok", finalEndpoint: "gmail.messages.list" },
				],
			);
		});

		it("asks the user to reconnect when a renewed token is still refused", async () => {
			const { history, attempts, observe } = harness(() => ({ status: 401, body: {} }));

			assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }), { ok: false, reason: "reauth-required" });
			assert.deepEqual(outcomes(attempts), [
				{ operation: "messages.get", attempt: 1, status: 401, classification: "token-refresh-retry", bodyReads: [] },
				{ operation: "messages.get", attempt: 2, status: 401, classification: "reauth-required", bodyReads: [] },
			]);
		});

		it("rethrows a transport failure on the renewed attempt after recording both attempts", async () => {
			let calls = 0;
			const failure = new TypeError("fetch failed", { cause: { code: "UND_ERR_SOCKET" } });
			const { history, attempts, observe } = harness(() => {
				calls += 1;
				return calls === 1 ? { status: 401, body: {} } : failure;
			});

			await assert.rejects(history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }), (error) => error === failure);

			assert.deepEqual(
				attempts.map(({ attempt, classification, transportFailure }) => ({ attempt, classification, transportFailure })),
				[
					{ attempt: 1, classification: "token-refresh-retry", transportFailure: undefined },
					{ attempt: 2, classification: "transport-failed", transportFailure: { errorName: "TypeError", errorCode: "UND_ERR_SOCKET" } },
				],
			);
		});

		it("passes on a token failure without calling Gmail", async () => {
			const { history, requests, attempts, observe } = harness(
				() => ({ status: 200, body: {} }),
				[{ ok: false, reason: "readonly-permission-required" }],
			);

			assert.deepEqual(
				await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe }),
				{ ok: false, reason: "readonly-permission-required" },
			);
			assert.equal(requests.length, 0);
			assert.deepEqual(attempts, []);
		});

		it("asks for read-only permission when Gmail says the token lacks the scope", async () => {
			for (const body of [
				{ error: { message: "Insufficient Permission", errors: [{ reason: "insufficientPermissions" }] } },
				{ error: { message: "Insufficient Permission", details: [{}, { reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } },
			]) {
				const { history, attempts, observe } = harness(() => ({ status: 403, body }));
				assert.deepEqual(await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }), {
					ok: false,
					reason: "readonly-permission-required",
				});
				assert.deepEqual(outcomes(attempts), [
					{
						operation: "messages.get",
						attempt: 1,
						status: 403,
						classification: "readonly-permission-required",
						bodyReads: [
							{
								source: "clone",
								outcome: "valid",
								measuredBytes: Buffer.byteLength(JSON.stringify(body)),
								errorName: undefined,
								fields: { errorPresent: true, errorReasonCount: 1, rateLimitReason: false, scopeReason: true, messagePresent: true },
							},
						],
					},
				]);
			}
		});

		it("reports rate limiting and outages as retryable", async () => {
			const rateLimited = { error: { message: "Rate Limit Exceeded", errors: [{ reason: "userRateLimitExceeded" }] } };
			for (const [reply, bodyReads] of [
				[
					{ status: 403, body: rateLimited },
					[
						{
							source: "clone",
							outcome: "valid",
							measuredBytes: Buffer.byteLength(JSON.stringify(rateLimited)),
							errorName: undefined,
							fields: { errorPresent: true, errorReasonCount: 1, rateLimitReason: true, scopeReason: false, messagePresent: true },
						},
					],
				],
				[{ status: 429, body: {} }, []],
				[{ status: 503 }, []],
			] as const) {
				const { history, attempts, observe } = harness(() => reply);
				assert.deepEqual(
					await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe }),
					{ ok: false, reason: "unavailable", status: reply.status },
				);
				assert.deepEqual(outcomes(attempts), [
					{ operation: "messages.list", attempt: 1, status: reply.status, classification: "unavailable", bodyReads },
				]);
			}
		});

		it("reports any other refusal as rejected with Gmail's message", async () => {
			const noService = { error: { message: "Mail service not enabled" } };
			const noServiceFields = { errorPresent: true, errorReasonCount: 0, rateLimitReason: false, scopeReason: false, messagePresent: true };
			const noServiceBytes = Buffer.byteLength(JSON.stringify(noService));
			for (const [reply, message, bodyReads] of [
				[
					{ status: 403, body: noService },
					"Mail service not enabled",
					[
						{ source: "clone", outcome: "valid", measuredBytes: noServiceBytes, errorName: undefined, fields: noServiceFields },
						{ source: "response", outcome: "valid", measuredBytes: noServiceBytes, errorName: undefined, fields: noServiceFields },
					],
				],
				[
					{ status: 403 },
					"status 403",
					[
						{ source: "clone", outcome: "json-decode-failed", measuredBytes: 8, errorName: "SyntaxError", fields: {} },
						{ source: "response", outcome: "json-decode-failed", measuredBytes: 8, errorName: "SyntaxError", fields: {} },
					],
				],
				[
					{ status: 400, body: { error: { message: "Invalid query" } } },
					"Invalid query",
					[
						{
							source: "response",
							outcome: "valid",
							measuredBytes: Buffer.byteLength(JSON.stringify({ error: { message: "Invalid query" } })),
							errorName: undefined,
							fields: noServiceFields,
						},
					],
				],
				[
					{ status: 400, body: { error: "invalid" } },
					"status 400",
					[
						{
							source: "response",
							outcome: "schema-rejected",
							measuredBytes: Buffer.byteLength(JSON.stringify({ error: "invalid" })),
							errorName: undefined,
							fields: { errorPresent: true, errorReasonCount: 0, rateLimitReason: false, scopeReason: false, messagePresent: false },
						},
					],
				],
			] as const) {
				const { history, attempts, observe } = harness(() => reply);
				assert.deepEqual(
					await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: undefined, observe }),
					{ ok: false, reason: "rejected", status: reply.status, message },
				);
				assert.deepEqual(outcomes(attempts), [
					{ operation: "messages.list", attempt: 1, status: reply.status, classification: "rejected", bodyReads },
				]);
			}
		});
	});

	describe("observation", () => {
		async function runScenario(observe: ObserveGmailHttpAttempt) {
			const replies: Reply[] = [
				{ status: 401, body: {} },
				{ status: 200, body: { messages: [{ id: "18c2f0a1b2" }], nextPageToken: "page-2" } },
				{ status: 403, body: { error: { message: "Mail service not enabled" } } },
				{ status: 404 },
				new TypeError("fetch failed"),
			];
			const { history, requests, refreshes } = harness(() => {
				const next = replies.shift();
				assert(next, "every Gmail call needs a queued reply");
				return next;
			});
			const results = [
				await history.listUnreadMessageIds({ userId: USER, sender: SENDER, window: WINDOW, pageToken: "page-1", observe }),
				await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }),
				await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }),
				await history.fetchRawMessage({ userId: USER, messageId: MESSAGE_ID, observe }).catch((error: unknown) => error),
			];
			return { results, requests: requests.map(({ href, method, authorization }) => ({ href, method, authorization })), refreshes };
		}

		it("leaves every result and request unchanged when the observer throws", async () => {
			const recorded: GmailHttpAttempt[] = [];
			const observed = await runScenario((attempt) => {
				recorded.push(attempt);
			});
			const unobserved = await runScenario(() => {
				throw new Error("observer broke");
			});

			assert.deepEqual(unobserved, observed);
			assert.equal(recorded.length, 5);
			assert.equal(observed.requests.length, 5);
		});

		it("never records tokens, secrets, senders, page tokens, message ids, bodies, arbitrary headers or error messages", async () => {
			const tokens = await readonlyTokenProvider({
				refreshToken: "refresh-sentinel-1",
				clientSecret: "client-secret-sentinel",
				replies: [tokenReply("access-sentinel-1"), tokenReply("access-sentinel-2")],
			});
			const sentinelHeaders = { "content-type": "application/json; boundary=sentinel", "x-debug-note": "sentinel note" };
			const replies: Response[] = [
				new Response(JSON.stringify({ error: { message: "Sentinel credentials expired" } }), { status: 401, headers: sentinelHeaders }),
				new Response(JSON.stringify({ messages: [{ id: "Sentinel77" }], nextPageToken: "next-sentinel-page" }), { status: 200, headers: sentinelHeaders }),
				new Response(
					JSON.stringify({ error: { message: "Sentinel quota note", errors: [{ reason: "sentinelReason", message: "sentinel" }] } }),
					{ status: 403, headers: sentinelHeaders },
				),
				new Response(JSON.stringify({ raw: Buffer.from("sentinel mail").toString("base64url"), internalDate: "1", labelIds: ["SENTINEL"] }), {
					status: 200,
					headers: sentinelHeaders,
				}),
				new Response(JSON.stringify({ error: { message: "Sentinel missing" } }), { status: 404, headers: sentinelHeaders }),
			];
			const attempts: GmailHttpAttempt[] = [];
			const observe: ObserveGmailHttpAttempt = (attempt) => {
				attempts.push(attempt);
			};
			let failed = false;
			const history: GmailHistory = initGmailHistory({
				accessToken: tokens.accessToken,
				fetch: async (input) => {
					const next = replies.shift();
					if (next === undefined) {
						failed = true;
						throw new TypeError("fetch failed for sentinel@example.com", { cause: { code: "sentinel code" } });
					}
					return reachedAt({ url: String(input), redirected: false, response: next });
				},
				now: tickingClock(7),
			});
			const sender = ForwardableSenderSchema.parse("sentinel@example.com");
			const messageId = GmailMessageIdSchema.parse("Sentinel77");

			await history.listUnreadMessageIds({ userId: USER, sender, window: WINDOW, pageToken: "page-sentinel", observe });
			await history.fetchRawMessage({ userId: USER, messageId, observe });
			await history.fetchRawMessage({ userId: USER, messageId, observe });
			await history.fetchRawMessage({ userId: USER, messageId, observe });
			await assert.rejects(history.listUnreadMessageIds({ userId: USER, sender, window: WINDOW, pageToken: "page-sentinel", observe }));

			assert.equal(failed, true);
			assert.deepEqual(
				attempts.map(({ operation, classification }) => `${operation}:${classification}`),
				[
					"oauth.refresh:ok",
					"messages.list:token-refresh-retry",
					"oauth.refresh:ok",
					"messages.list:ok",
					"messages.get:rejected",
					"messages.get:ok",
					"messages.get:not-found",
					"messages.list:transport-failed",
				],
			);
			assert.equal(JSON.stringify(attempts).toLowerCase().includes("sentinel"), false);
		});
	});
});
