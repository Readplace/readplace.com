import assert from "node:assert/strict";
import type {
	GmailHttpAttempt,
	GmailHttpRequestSettings,
	GmailHttpResponseHeaders,
} from "@packages/provider-contracts/gmail-history";
import {
	GMAIL_API_ORIGIN,
	GOOGLE_OAUTH_ORIGIN,
	type JsonBody,
	member,
	observedFetch,
	readJsonBody,
} from "./gmail-http-evidence";

const LISTING: GmailHttpRequestSettings = {
	operation: "messages.list",
	fieldMask: "messages(id),nextPageToken",
	pageSize: 25,
	includeSpamTrash: false,
	pageTokenPresent: false,
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

const LISTING_URL = `${GMAIL_API_ORIGIN}/gmail/v1/users/me/messages`;

const PROVIDER_IDS = {
	"x-goog-request-id": "req_ABC-123",
	"x-guploader-uploadid": "AHMx-upload_42",
	"x-cloud-trace-context": "105445aa7843bc8bf206b12000100000/1;o=1",
};

function responseAt(input: { url: string; redirected: boolean; body: string | null; init: ResponseInit }): Response {
	const response = new Response(input.body, input.init);
	Object.defineProperty(response, "url", { value: input.url });
	Object.defineProperty(response, "redirected", { value: input.redirected });
	return response;
}

const UTF8_BOM = [0xef, 0xbb, 0xbf];

function bytesOf(...parts: (string | number[])[]) {
	return Uint8Array.from(parts.flatMap((part) => (typeof part === "string" ? [...Buffer.from(part)] : part)));
}

function decodedAsJson(body: JsonBody) {
	return body.outcome === "decoded"
		? { outcome: body.outcome, json: JSON.stringify(body.json) }
		: { outcome: body.outcome, errorName: member(body.error, "name") };
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

function harness(input: { expectedOrigin: string; reply: () => Promise<Response> }) {
	const attempts: GmailHttpAttempt[] = [];
	let clock = Date.parse("2026-10-05T00:00:00.000Z");
	const send = () =>
		observedFetch({
			fetch: async () => input.reply(),
			now: () => {
				const current = new Date(clock);
				clock += 40;
				return current;
			},
			url: LISTING_URL,
			init: { method: "GET" },
			target: { request: LISTING, attempt: 2, requestedEndpoint: "gmail.messages.list", expectedOrigin: input.expectedOrigin },
			observe: (attempt) => {
				attempts.push(attempt);
			},
		});
	return { attempts, send };
}

describe("observedFetch", () => {
	it("records the response it settled on with its allowlisted headers normalized", async () => {
		const { attempts, send } = harness({
			expectedOrigin: GMAIL_API_ORIGIN,
			reply: async () =>
				responseAt({
					url: `${GMAIL_API_ORIGIN}/gmail/v1/users/me/messages?q=from%3Asentinel%40example.com`,
					redirected: false,
					body: "{}",
					init: {
						status: 200,
						headers: {
							"content-type": "Application/JSON; charset=UTF-8",
							"content-length": "1234",
							"content-encoding": "GZIP",
							date: "Mon, 05 Oct 2026 10:00:00 GMT",
							"retry-after": "120",
							"x-sentinel-note": "private sentinel value",
							...PROVIDER_IDS,
						},
					},
				}),
		});

		const { response, settle } = await send();
		settle({ classification: "ok", bodyReads: [] });

		assert.equal(response.status, 200);
		assert.deepEqual(attempts, [
			{
				operation: "messages.list",
				attempt: 2,
				request: LISTING,
				requestedEndpoint: "gmail.messages.list",
				durationMs: 40,
				response: {
					status: 200,
					redirected: false,
					finalEndpoint: "gmail.messages.list",
					finalOriginExpected: true,
					bodyNull: false,
					headers: {
						contentType: "application/json",
						declaredContentLength: 1234,
						contentEncoding: "gzip",
						date: "2026-10-05T10:00:00.000Z",
						retryAfter: "120",
						googRequestId: "req_ABC-123",
						guploaderUploadId: "AHMx-upload_42",
						cloudTraceContext: "105445aa7843bc8bf206b12000100000/1;o=1",
					},
					bodyReads: [],
				},
				transportFailure: undefined,
				classification: "ok",
			},
		]);
		assert.equal(JSON.stringify(attempts).toLowerCase().includes("sentinel"), false);
	});

	it("names the endpoint a response came from without recording its address", async () => {
		const cases = [
			{ expectedOrigin: GMAIL_API_ORIGIN, url: `${GMAIL_API_ORIGIN}/gmail/v1/users/me/messages?pageToken=sentinel`, endpoint: "gmail.messages.list", originExpected: true },
			{ expectedOrigin: GMAIL_API_ORIGIN, url: `${GMAIL_API_ORIGIN}/gmail/v1/users/me/messages/Sentinel42?format=RAW`, endpoint: "gmail.messages.get", originExpected: true },
			{ expectedOrigin: GMAIL_API_ORIGIN, url: `${GMAIL_API_ORIGIN}/gmail/v1/users/me/sentinel`, endpoint: "other-expected-origin", originExpected: true },
			{ expectedOrigin: GOOGLE_OAUTH_ORIGIN, url: `${GOOGLE_OAUTH_ORIGIN}/token`, endpoint: "oauth.token", originExpected: true },
			{ expectedOrigin: GOOGLE_OAUTH_ORIGIN, url: `${GOOGLE_OAUTH_ORIGIN}/gmail/v1/users/me/messages`, endpoint: "other-expected-origin", originExpected: true },
			{ expectedOrigin: GMAIL_API_ORIGIN, url: "https://accounts.example/sentinel?continue=sentinel", endpoint: "unexpected-origin", originExpected: false },
		] as const;

		for (const { expectedOrigin, url, endpoint, originExpected } of cases) {
			const { attempts, send } = harness({
				expectedOrigin,
				reply: async () => responseAt({ url, redirected: true, body: null, init: { status: 302 } }),
			});

			(await send()).settle({ classification: "unavailable", bodyReads: [] });

			const reached = attempts[0].response;
			assert(reached, `a response must be recorded for ${url}`);
			assert.deepEqual(
				{ finalEndpoint: reached.finalEndpoint, finalOriginExpected: reached.finalOriginExpected, redirected: reached.redirected },
				{ finalEndpoint: endpoint, finalOriginExpected: originExpected, redirected: true },
			);
			assert.equal(JSON.stringify(attempts).toLowerCase().includes("sentinel"), false);
		}
	});

	it("drops provider request ids unless the response came from the origin it was sent to", async () => {
		const { attempts, send } = harness({
			expectedOrigin: GMAIL_API_ORIGIN,
			reply: async () =>
				responseAt({ url: "https://accounts.example/ServiceLogin", redirected: true, body: null, init: { status: 200, headers: PROVIDER_IDS } }),
		});

		(await send()).settle({ classification: "unavailable", bodyReads: [] });

		assert.deepEqual(attempts[0].response?.headers, NO_HEADERS);
	});

	it("drops header values that do not have the expected shape", async () => {
		const { attempts, send } = harness({
			expectedOrigin: GMAIL_API_ORIGIN,
			reply: async () =>
				responseAt({
					url: LISTING_URL,
					redirected: false,
					body: null,
					init: {
						status: 200,
						headers: {
							"content-type": "text/html<sentinel>",
							"content-length": "12 sentinel",
							"content-encoding": "gzip;q=sentinel",
							date: "yesterday sentinel",
							"retry-after": "after the sentinel",
							"x-goog-request-id": "sentinel request id",
							"x-guploader-uploadid": "sentinel/upload",
							"x-cloud-trace-context": "sentinel-trace",
						},
					},
				}),
		});

		(await send()).settle({ classification: "ok", bodyReads: [] });

		assert.deepEqual(attempts[0].response?.headers, NO_HEADERS);
	});

	it("reads dates only when they name a real instant, and a retry delay as seconds or a date", async () => {
		const cases = [
			{ date: "Mon, 99 Jan 2026 00:00:00 GMT", retryAfter: "Mon, 05 Oct 2026 10:02:00 GMT", expected: { date: undefined, retryAfter: "2026-10-05T10:02:00.000Z" } },
			{ date: "Mon, 05 Oct 2026 10:00:00 GMT", retryAfter: "Mon, 99 Jan 2026 00:00:00 GMT", expected: { date: "2026-10-05T10:00:00.000Z", retryAfter: undefined } },
		];

		for (const { date, retryAfter, expected } of cases) {
			const { attempts, send } = harness({
				expectedOrigin: GMAIL_API_ORIGIN,
				reply: async () =>
					responseAt({ url: LISTING_URL, redirected: false, body: null, init: { status: 429, headers: { date, "retry-after": retryAfter } } }),
			});

			(await send()).settle({ classification: "unavailable", bodyReads: [] });

			assert.deepEqual(attempts[0].response?.headers, { ...NO_HEADERS, ...expected });
		}
	});

	it("records each body read with its measured size and a summary only of a body it could decode", async () => {
		const reads = {
			valid: await readJsonBody(new Response('﻿{"messages":[]}')),
			rejected: await readJsonBody(new Response("[1,2]")),
			empty: await readJsonBody(new Response(null, { status: 204 })),
			unreadable: await readJsonBody(erroredBody(new RangeError("sentinel stream failure"))),
		};
		const summarize = (json: unknown) => ({ array: Array.isArray(json) });
		const { attempts, send } = harness({
			expectedOrigin: GMAIL_API_ORIGIN,
			reply: async () => responseAt({ url: LISTING_URL, redirected: false, body: null, init: { status: 204 } }),
		});

		(await send()).settle({
			classification: "unavailable",
			bodyReads: [
				{ source: "clone", body: reads.valid, accepted: true, summarize },
				{ source: "response", body: reads.rejected, accepted: false, summarize },
				{ source: "response", body: reads.empty, accepted: false, summarize },
				{ source: "response", body: reads.unreadable, accepted: false, summarize },
			],
		});

		assert.deepEqual(reads.valid, {
			outcome: "decoded",
			json: { messages: [] },
			measuredBytes: Buffer.byteLength('﻿{"messages":[]}'),
		});
		assert.equal(attempts[0].response?.bodyNull, true);
		assert.deepEqual(attempts[0].response?.bodyReads, [
			{ source: "clone", outcome: "valid", measuredBytes: 18, errorName: undefined, fields: { array: false } },
			{ source: "response", outcome: "schema-rejected", measuredBytes: 5, errorName: undefined, fields: { array: true } },
			{ source: "response", outcome: "json-decode-failed", measuredBytes: 0, errorName: "SyntaxError", fields: {} },
			{ source: "response", outcome: "body-read-failed", measuredBytes: undefined, errorName: "RangeError", fields: {} },
		]);
		assert.equal(JSON.stringify(attempts).toLowerCase().includes("sentinel"), false);
	});

	it("records a transport failure by error name and validated code, then rethrows the same error", async () => {
		const cases = [
			{ failure: new TypeError("fetch failed sentinel", { cause: { code: "ECONNRESET" } }), expected: { errorName: "TypeError", errorCode: "ECONNRESET" } },
			{ failure: Object.assign(new Error("sentinel timeout"), { code: "ETIMEDOUT" }), expected: { errorName: "Error", errorCode: "ETIMEDOUT" } },
			{ failure: new TypeError("fetch failed", { cause: { code: "econnreset sentinel" } }), expected: { errorName: "TypeError", errorCode: undefined } },
			{ failure: "sentinel string thrown", expected: { errorName: "unknown", errorCode: undefined } },
		];

		for (const { failure, expected } of cases) {
			const { attempts, send } = harness({
				expectedOrigin: GMAIL_API_ORIGIN,
				reply: async () => {
					throw failure;
				},
			});

			await assert.rejects(send(), (error) => error === failure);

			assert.deepEqual(attempts, [
				{
					operation: "messages.list",
					attempt: 2,
					request: LISTING,
					requestedEndpoint: "gmail.messages.list",
					durationMs: 40,
					response: undefined,
					transportFailure: expected,
					classification: "transport-failed",
				},
			]);
			assert.equal(JSON.stringify(attempts).toLowerCase().includes("sentinel"), false);
		}
	});

	it("leaves the exchange untouched when observing it fails", async () => {
		const failure = new TypeError("fetch failed");
		let calls = 0;
		const exchange = (reply: () => Promise<Response>) =>
			observedFetch({
				fetch: async () => {
					calls += 1;
					return reply();
				},
				now: () => new Date("2026-10-05T00:00:00.000Z"),
				url: LISTING_URL,
				init: { method: "GET" },
				target: { request: LISTING, attempt: 1, requestedEndpoint: "gmail.messages.list", expectedOrigin: GMAIL_API_ORIGIN },
				observe: () => {
					throw new Error("observer broke");
				},
			});

		const observed = await exchange(async () => responseAt({ url: LISTING_URL, redirected: false, body: "{}", init: { status: 200 } }));
		observed.settle({ classification: "ok", bodyReads: [] });
		await assert.rejects(
			exchange(async () => {
				throw failure;
			}),
			(error) => error === failure,
		);

		assert.equal(observed.response.status, 200);
		assert.equal(calls, 2);
	});

	it("records nothing rather than fail when the response cannot be described", async () => {
		const { attempts, send } = harness({
			expectedOrigin: GMAIL_API_ORIGIN,
			reply: async () => responseAt({ url: "not a url", redirected: false, body: "{}", init: { status: 200 } }),
		});

		const { response, settle } = await send();
		settle({ classification: "ok", bodyReads: [] });

		assert.equal(await response.text(), "{}");
		assert.deepEqual(attempts, []);
	});
});

describe("readJsonBody", () => {
	it("decodes a body to the same value as Response.json(), measuring every byte received", async () => {
		const listing = '{"messages":[{"id":"18c2f0a1b2"}]}';
		const cases = [
			{ name: "empty", bytes: bytesOf(), outcome: "json-decode-failed" },
			{ name: "one byte order mark", bytes: bytesOf(UTF8_BOM, listing), outcome: "decoded" },
			{ name: "two byte order marks", bytes: bytesOf(UTF8_BOM, UTF8_BOM, listing), outcome: "decoded" },
			{ name: "three byte order marks", bytes: bytesOf(UTF8_BOM, UTF8_BOM, UTF8_BOM, listing), outcome: "json-decode-failed" },
			{ name: "invalid UTF-8 inside a string", bytes: bytesOf('{"id":"', [0xff, 0xc3], '"}'), outcome: "decoded" },
			{ name: "invalid UTF-8 outside a string", bytes: bytesOf([0xff, 0xfe]), outcome: "json-decode-failed" },
			{ name: "whitespace only", bytes: bytesOf(" \r\n\t "), outcome: "json-decode-failed" },
			{ name: "valid JSON", bytes: bytesOf(listing), outcome: "decoded" },
		];

		for (const { name, bytes, outcome } of cases) {
			const expected = await new Response(bytes).json().then(
				(json: unknown) => ({ outcome: "decoded", json: JSON.stringify(json) }),
				(error: unknown) => ({ outcome: "json-decode-failed", errorName: member(error, "name") }),
			);

			const body = await readJsonBody(new Response(bytes));

			assert.equal(body.outcome, outcome, name);
			assert.deepEqual(decodedAsJson(body), expected, name);
			assert.equal("measuredBytes" in body ? body.measuredBytes : undefined, bytes.byteLength, name);
		}
	});
});
