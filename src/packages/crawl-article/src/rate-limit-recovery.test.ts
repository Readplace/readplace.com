import { initCrawlFetch, PROXIED_CRAWL_HEADERS_MILLISECONDS } from "./crawl-fetch";
import { createCurlFetch } from "./curl-fetch";
import { classifyFetchError } from "./classify-fetch-failure";

const URL = "https://web.archive.org/web/https://publisher.example/article";

function refused(): Error {
	return new TypeError("fetch failed", { cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }) });
}

function setup(input: { proxyStatus: number; initialError?: Error; retryError?: Error; curlError?: Error; signal?: AbortSignal; redirectOnRetry?: boolean; onRetry?: () => void }) {
	let primaryCalls = 0;
	const requestedUrls: string[] = [];
	const attempts: string[] = [];
	const original = new Response("<p>Too many requests</p>", {
		status: 429,
		statusText: "Too Many Requests",
		headers: { "content-type": "text/html", "retry-after": "60" },
	});
	Object.defineProperty(original, "url", { value: URL, configurable: true });
	const crawlFetch = initCrawlFetch({
		fetch: async (url) => {
			primaryCalls++;
			requestedUrls.push(String(url));
			if (primaryCalls === 1) {
				if (input.initialError) throw input.initialError;
				return original;
			}
			if (primaryCalls === 2 && input.redirectOnRetry) return new Response(null, { status: 302, headers: { location: "https://changed.example/article" } });
			if (primaryCalls === 2 || (primaryCalls === 3 && input.redirectOnRetry)) {
				input.onRetry?.();
				throw input.retryError ?? refused();
			}
			return new Response("proxy response", { status: input.proxyStatus });
		},
		fetchH2: async () => { throw refused(); },
		fetchCurl: createCurlFetch({
			resolvePinnedAddress: async () => "93.184.216.34",
			execCurl: (_args, callback) => {
				queueMicrotask(() => callback(input.curlError ?? Object.assign(new Error("could not connect"), { code: 7 }), Buffer.alloc(0)));
				return { kill: () => {}, onClose: () => {} };
			},
		}),
		personas: [{ name: "test", headers: {} }],
		isBlocked: () => false,
		proxyUrl: "http://proxy.example:8080",
		rateLimitRetryDelaysMs: [1],
		logInfo: (line) => attempts.push(line),
	});
	return {
		run: () => crawlFetch(URL, { budgetMs: PROXIED_CRAWL_HEADERS_MILLISECONDS, signal: input.signal }),
		requestedUrls,
		attempts,
	};
}

it("recovers through the proxy after a 429 retry loses every direct connection", async () => {
	const harness = setup({ proxyStatus: 200 });
	const response = await harness.run();
	expect(response.status).toBe(200);
	expect(await response.text()).toBe("proxy response");
	expect(harness.requestedUrls).toEqual([URL, URL, URL]);
	expect(harness.attempts.map((line) => JSON.parse(line)).filter((attempt) => attempt.via === "proxy")).toEqual([
		expect.objectContaining({ leg: "primary", outcome: "answered", status: 200 }),
	]);
});

it("keeps an origin-unreachable failure when no transport ever receives a response", async () => {
	const harness = setup({ proxyStatus: 200, initialError: refused() });
	const error = await harness.run().then(() => { throw new Error("expected a failed crawl"); }, (error: unknown) => error);
	expect(classifyFetchError(error)).toEqual({ kind: "origin-unreachable", code: "ECONNREFUSED" });
	expect(harness.requestedUrls).toEqual([URL]);
});

it("retains the complete 429 when its retry and both proxy attempts fail", async () => {
	const harness = setup({ proxyStatus: 502 });
	const response = await harness.run();
	expect(response.status).toBe(429);
	expect(response.statusText).toBe("Too Many Requests");
	expect(response.url).toBe(URL);
	expect(response.headers.get("retry-after")).toBe("60");
	expect(response.headers.get("content-type")).toBe("text/html");
	expect(await response.text()).toBe("<p>Too many requests</p>");
	expect(harness.requestedUrls).toEqual([URL, URL, URL, URL]);
});

it("keeps the retained response's URL when a failed retry observes a different redirect", async () => {
	const harness = setup({ proxyStatus: 200, redirectOnRetry: true });
	expect((await harness.run()).status).toBe(200);
	expect(harness.requestedUrls).toEqual([URL, URL, "https://changed.example/article", URL]);
});

it.each([
	{ label: "unknown primary failure before connection failures", retryError: new Error("programming failure"), curlError: undefined },
	{ label: "unknown curl failure after connection failures", retryError: undefined, curlError: new Error("programming failure") },
	{ label: "missing curl binary", retryError: undefined, curlError: Object.assign(new Error("missing binary"), { code: "ENOENT" }) },
])("propagates $label instead of using an earlier network error to recover", async ({ retryError, curlError }) => {
	const harness = setup({ proxyStatus: 200, retryError, curlError });
	await expect(harness.run()).rejects.toThrow();
	expect(harness.requestedUrls).toEqual(curlError === undefined ? [URL, URL] : [URL]);
});

it.each(["primary", "curl"])("propagates a nested blocked-address rejection from %s", async (leg) => {
	const security = new TypeError("fetch failed", { cause: Object.assign(new Error("blocked address"), { code: "EBLOCKEDADDRESS" }) });
	const harness = setup({ proxyStatus: 200, retryError: leg === "primary" ? security : undefined, curlError: leg === "curl" ? security : undefined });
	await expect(harness.run()).rejects.toThrow("fetch failed");
	expect(harness.requestedUrls).toEqual(leg === "primary" ? [URL, URL] : [URL]);
});

it("propagates caller cancellation during the retry without opening the proxy", async () => {
	const controller = new AbortController();
	const reason = new Error("caller cancelled");
	const harness = setup({ proxyStatus: 200, signal: controller.signal, onRetry: () => controller.abort(reason) });
	await expect(harness.run()).rejects.toBe(reason);
	expect(harness.requestedUrls).toEqual([URL, URL]);
});
