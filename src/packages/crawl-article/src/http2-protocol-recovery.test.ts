import { createCrawlBudget } from "./crawl-budget";
import { withPersonaFallback } from "./persona-fallback";
import { withProxiedLadderFallback } from "./proxied-ladder-fallback";
import { type LegFetch, runTransportLadder } from "./transport-ladder";
import { TransportLadderFailure } from "./transport-ladder-failure";

function protocolError(): Error {
	return Object.assign(new Error("Protocol error"), { code: "ERR_HTTP2_ERROR" });
}

function composedFetch(deps: { primary: LegFetch; h2: LegFetch; curl: LegFetch }) {
	const attempts: string[] = [];
	const now = () => 0;
	const ladder = runTransportLadder({
		legs: [
			{ name: "primary", maxRunMs: 10_000, fetch: deps.primary },
			{ name: "h2", maxRunMs: 10_000, fetch: deps.h2 },
			{ name: "curl", maxRunMs: 10_000, fetch: deps.curl },
		],
		logAttempt: ({ leg }) => { attempts.push(leg); },
		now,
	});
	const fetch = withProxiedLadderFallback({
		directFetch: withPersonaFallback(ladder, [
			{ name: "first", headers: {} },
			{ name: "second", headers: { "user-agent": "alternate" } },
		]),
		proxyFetch: async (url) => {
			attempts.push(url);
			return new Response("<article><h1>Example</h1><p>Complete article from the origin.</p></article>");
		},
		proxyReserveMilliseconds: 45_000,
		now,
	});
	return {
		attempts,
		fetch: () => fetch("https://example.com/article", {
			headers: {},
			budget: createCrawlBudget({ signal: new AbortController().signal, totalMs: 90_000, now }),
		}),
	};
}

it.each([
	{ primary: "402", wrapped: false },
	{ primary: "403", wrapped: false },
	{ primary: "timeout", wrapped: false },
	{ primary: "402", wrapped: true },
])("recovers article content through personas and proxy after $primary and HTTP/2 failure (wrapped: $wrapped)", async ({ primary, wrapped }) => {
	const harness = composedFetch({
		primary: async () => {
			if (primary === "timeout") throw Object.assign(new Error("leg deadline"), { name: "TimeoutError" });
			return new Response("denied", { status: Number(primary) });
		},
		h2: async () => { throw wrapped ? new Error("request failed", { cause: protocolError() }) : protocolError(); },
		curl: async () => new Response("denied", { status: primary === "402" ? 402 : 403 }),
	});

	const response = await harness.fetch();

	expect(response.status).toBe(200);
	expect(await response.text()).toBe("<article><h1>Example</h1><p>Complete article from the origin.</p></article>");
	expect(harness.attempts).toEqual(["primary", "h2", "curl", "primary", "h2", "curl", "https://example.com/article"]);
});

it.each([
	{ name: "uncoded protocol error", error: new Error("Protocol error") },
	{ name: "different HTTP/2 code", error: Object.assign(new Error("Protocol error"), { code: "ERR_HTTP2_INVALID_SESSION" }) },
	{ name: "programming error", error: new TypeError("invalid response") },
	{ name: "non-Error rejection", error: { code: "ERR_HTTP2_ERROR", message: "Protocol error" } },
	{ name: "TLS certificate error", error: Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }) },
])("preserves an unclassified $name before a recognized HTTP/2 error without invoking proxy", async ({ error }) => {
	const harness = composedFetch({
		primary: async () => { throw error; },
		h2: async () => { throw protocolError(); },
		curl: async () => new Response("denied", { status: 403 }),
	});

	await expect(harness.fetch()).rejects.toMatchObject({
		retryDisposition: "unclassified",
		previousErrors: [error],
		cause: protocolError(),
	});
	expect(harness.attempts).toEqual(["primary", "h2", "curl"]);
});

it("preserves an unknown failure after a recognized HTTP/2 failure without invoking proxy", async () => {
	const error = new TypeError("invalid curl response");
	const harness = composedFetch({
		primary: async () => new Response("denied", { status: 402 }),
		h2: async () => { throw protocolError(); },
		curl: async () => { throw error; },
	});

	await expect(harness.fetch()).rejects.toBeInstanceOf(TransportLadderFailure);
	expect(harness.attempts).toEqual(["primary", "h2", "curl"]);
});

it.each([
	{ name: "abort", error: Object.assign(new Error("cancelled", { cause: protocolError() }), { name: "AbortError" }) },
	{ name: "blocked address", error: Object.assign(new Error("private destination", { cause: protocolError() }), { code: "EBLOCKEDADDRESS" }) },
	{ name: "nested abort", error: Object.assign(new Error("Protocol error", { cause: Object.assign(new Error("cancelled"), { name: "AbortError" }) }), { code: "ERR_HTTP2_ERROR" }) },
	{ name: "nested blocked address", error: Object.assign(new Error("Protocol error", { cause: Object.assign(new Error("private destination"), { code: "EBLOCKEDADDRESS" }) }), { code: "ERR_HTTP2_ERROR" }) },
])("propagates $name despite recognized-looking causes without continuing the ladder or proxy", async ({ error }) => {
	const harness = composedFetch({
		primary: async () => new Response("denied", { status: 403 }),
		h2: async () => { throw error; },
		curl: async () => new Response("denied", { status: 403 }),
	});

	await expect(harness.fetch()).rejects.toBe(error);
	expect(harness.attempts).toEqual(["primary", "h2"]);
});
