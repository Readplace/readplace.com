import assert from "node:assert";
import { initCrawlFetch } from "./crawl-fetch";

const stubFetch: typeof fetch = async () => new Response("ok");

function createCrawlFetch() {
	return initCrawlFetch({
		fetch: stubFetch,
		personas: [{ name: "test", headers: { "user-agent": "test" } }],
		isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
	});
}

describe("initCrawlFetch", () => {
	it("throws when referer is passed in both `referer` field and `headers`", async () => {
		const crawlFetch = createCrawlFetch();
		await assert.rejects(
			() =>
				crawlFetch("https://example.com", {
					budgetMs: 30_000,
					referer: "https://article.com",
					headers: { referer: "https://other.com" },
				}),
			{
				message:
					"Pass referer via the `referer` field or `headers.referer`, not both",
			},
		);
	});

	it("recovers from a rate-limited origin by retrying through the composed stack", async () => {
		let primaryCalls = 0;
		const rateLimitedFetch: typeof fetch = async () => {
			primaryCalls += 1;
			return primaryCalls === 1 ? new Response("slow down", { status: 429 }) : new Response("ok");
		};
		// A 429 fans out to the h2/curl fallbacks (Cloudflare expresses bot-blocks
		// as 429), so inject them too and keep them rate-limited — otherwise the
		// real fetchers run and hit the network. This keeps the test hermetic and
		// pins the recovery on the rate-limit retry, not the fallback.
		const stillRateLimited = async (): Promise<Response> => new Response("slow down", { status: 429 });
		const crawlFetch = initCrawlFetch({
			fetch: rateLimitedFetch,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
			fetchH2: stillRateLimited,
			fetchCurl: stillRateLimited,
			rateLimitRetryDelaysMs: [1],
		});

		const response = await crawlFetch("https://example.com", { budgetMs: 30_000 });

		assert.equal(response.status, 200);
		assert.equal(await response.text(), "ok");
		assert.equal(primaryCalls, 2);
	});

	it("runs the whole direct ladder, then re-runs the primary leg proxied, and a proxied answer wins", async () => {
		let directCurlCalls = 0;
		let directH2Calls = 0;
		let primaryCalls = 0;
		const blockedThenProxied: typeof fetch = async () => {
			primaryCalls += 1;
			return primaryCalls === 1 ? new Response("denied", { status: 403 }) : new Response("via proxy");
		};
		const blockedH2 = async (): Promise<Response> => {
			directH2Calls += 1;
			return new Response("denied", { status: 403 });
		};
		const blockedCurl = async (): Promise<Response> => {
			directCurlCalls += 1;
			return new Response("denied", { status: 403 });
		};
		const crawlFetch = initCrawlFetch({
			fetch: blockedThenProxied,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			fetchH2: blockedH2,
			fetchCurl: blockedCurl,
			proxyUrl: "http://proxy.example:8080",
		});

		const response = await crawlFetch("https://example.com", { budgetMs: 30_000 });

		assert.equal(response.status, 200);
		assert.equal(await response.text(), "via proxy");
		assert.equal(directH2Calls, 1);
		assert.equal(directCurlCalls, 1);
		assert.equal(primaryCalls, 2);
	});

	it("builds the proxied pass but leaves it unused when the direct pass answers", async () => {
		const crawlFetch = initCrawlFetch({
			fetch: stubFetch,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: "http://proxy.example:8080",
		});

		const response = await crawlFetch("https://example.com", { budgetMs: 30_000 });

		assert.equal(response.status, 200);
	});

	it("skips the proxied pass for a budget too small to seat both passes", async () => {
		let primaryCalls = 0;
		const blockedFetch: typeof fetch = async () => {
			primaryCalls += 1;
			return new Response("denied", { status: 403 });
		};
		const blocked = async (): Promise<Response> => new Response("denied", { status: 403 });
		const crawlFetch = initCrawlFetch({
			fetch: blockedFetch,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			fetchH2: blocked,
			fetchCurl: blocked,
			proxyUrl: "http://proxy.example:8080",
		});

		const response = await crawlFetch("https://example.com", { budgetMs: 5000 });

		assert.equal(response.status, 403);
		assert.equal(primaryCalls, 1);
	});

	it("does not run a proxied pass when no proxyUrl is configured", async () => {
		let curlCalls = 0;
		const blockedFetch: typeof fetch = async () => new Response("denied", { status: 403 });
		const blocked = async (): Promise<Response> => new Response("denied", { status: 403 });
		const countedCurl = async (): Promise<Response> => {
			curlCalls += 1;
			return new Response("denied", { status: 403 });
		};
		const crawlFetch = initCrawlFetch({
			fetch: blockedFetch,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
			fetchH2: blocked,
			fetchCurl: countedCurl,
		});

		const response = await crawlFetch("https://example.com", { budgetMs: 30_000 });

		assert.equal(response.status, 403);
		assert.equal(curlCalls, 1);
	});

	it("follows a redirect on the primary leg itself, requesting each hop with redirect:manual and returning the terminal as response.url", async () => {
		const requested: Array<{ url: string; redirect: RequestInit["redirect"] }> = [];
		const redirectingOrigin: typeof fetch = async (input, init) => {
			const url = String(input);
			requested.push({ url, redirect: init?.redirect });
			return url === "https://wrapper.example/link"
				? new Response(null, { status: 301, headers: { location: "https://dest.example/article" } })
				: new Response("<html>article</html>", { status: 200 });
		};
		const crawlFetch = initCrawlFetch({
			fetch: redirectingOrigin,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
		});

		const response = await crawlFetch("https://wrapper.example/link", { budgetMs: 30_000 });

		assert.equal(response.url, "https://dest.example/article");
		assert.deepEqual(requested, [
			{ url: "https://wrapper.example/link", redirect: "manual" },
			{ url: "https://dest.example/article", redirect: "manual" },
		]);
	});

	it("reports the primary leg's redirect hops to the caller's onRedirect", async () => {
		const redirectingOrigin: typeof fetch = async (input) =>
			String(input) === "https://wrapper.example/link"
				? new Response(null, { status: 301, headers: { location: "https://dest.example/article" } })
				: new Response("<html>article</html>", { status: 200 });
		const crawlFetch = initCrawlFetch({
			fetch: redirectingOrigin,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
		});
		const hops: Array<{ fromUrl: string; toUrl: string }> = [];

		await crawlFetch("https://wrapper.example/link", { budgetMs: 30_000, onRedirect: (hop) => hops.push(hop) });

		assert.deepEqual(hops, [
			{ fromUrl: "https://wrapper.example/link", toUrl: "https://dest.example/article" },
		]);
	});

	it("surfaces the budget's own timeout when every transport outlives it", async () => {
		const outlivesTheBudget = async (): Promise<Response> => {
			await new Promise((resolve) => setTimeout(resolve, 200));
			throw new Error("leg failed long after the budget was spent");
		};
		const crawlFetch = initCrawlFetch({
			fetch: outlivesTheBudget,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
			fetchH2: outlivesTheBudget,
			fetchCurl: outlivesTheBudget,
		});

		await assert.rejects(() => crawlFetch("https://example.com", { budgetMs: 20 }), {
			name: "TimeoutError",
			message: "no response headers within 20ms",
		});
	});

	it("cancels an in-flight crawl when the caller aborts its own signal", async () => {
		const stalls: typeof fetch = (_input, init) =>
			new Promise((_resolve, reject) => {
				const signal = init?.signal;
				assert(signal, "every leg receives a deadline");
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		const crawlFetch = initCrawlFetch({
			fetch: stalls,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
		});
		const controller = new AbortController();

		setTimeout(() => controller.abort(new Error("caller cancelled")), 5);
		await assert.rejects(
			() => crawlFetch("https://example.com", { budgetMs: 60_000, signal: controller.signal }),
			{ message: "caller cancelled" },
		);
	});

	it("refuses immediately when the caller's signal is already aborted", async () => {
		const stalls: typeof fetch = (_input, init) =>
			new Promise((_resolve, reject) => {
				const signal = init?.signal;
				assert(signal, "every leg receives a deadline");
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			});
		const crawlFetch = initCrawlFetch({
			fetch: stalls,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
		});
		const controller = new AbortController();
		controller.abort(new Error("caller gave up first"));

		await assert.rejects(
			() => crawlFetch("https://example.com", { budgetMs: 60_000, signal: controller.signal }),
			{ message: "caller gave up first" },
		);
	});

	it("records every leg it tried, so a failing transport is attributable in production logs", async () => {
		const lines: string[] = [];
		const crawlFetch = initCrawlFetch({
			fetch: async () => new Response("challenge", { status: 403 }),
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			logInfo: (message) => lines.push(message),
			proxyUrl: undefined,
			fetchH2: async () => new Response("challenge", { status: 403 }),
			fetchCurl: async () => new Response("ok", { status: 200 }),
		});

		await crawlFetch("https://example.com", { budgetMs: 30_000 });

		const attempts = lines.map((line) => JSON.parse(line));
		assert.deepEqual(
			attempts.map((a) => [a.stream, a.leg, a.outcome]),
			[
				["crawl-legs", "primary", "escalated"],
				["crawl-legs", "h2", "escalated"],
				["crawl-legs", "curl", "answered"],
			],
		);
	});

	it("recovers from a persona-keyed 498 without fanning out to the TLS-client fallbacks", async () => {
		const userAgents: string[] = [];
		const personaAware: typeof fetch = async (_input, init) => {
			const userAgent = new Headers(init?.headers).get("user-agent");
			assert(userAgent, "persona fallback always sends a user-agent");
			userAgents.push(userAgent);
			return userAgent === "Blocked/1.0"
				? new Response("nope", { status: 498 })
				: new Response("ok");
		};
		const neverCalled = async (): Promise<Response> => {
			throw new Error("498 must not fan out to the TLS-client fallbacks");
		};
		const crawlFetch = initCrawlFetch({
			fetch: personaAware,
			personas: [
				{ name: "blocked", headers: { "user-agent": "Blocked/1.0" } },
				{ name: "allowed", headers: { "user-agent": "Allowed/1.0" } },
			],
			isBlocked: () => false,
			logInfo: () => {},
			proxyUrl: undefined,
			fetchH2: neverCalled,
			fetchCurl: neverCalled,
		});

		const response = await crawlFetch("https://example.com", { budgetMs: 30_000 });

		assert.equal(response.status, 200);
		assert.equal(await response.text(), "ok");
		assert.deepEqual(userAgents, ["Blocked/1.0", "Allowed/1.0"]);
	});
});
