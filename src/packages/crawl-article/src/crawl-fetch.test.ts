import assert from "node:assert";
import { initCrawlFetch } from "./crawl-fetch";

const stubFetch: typeof fetch = async () => new Response("ok");

function createCrawlFetch() {
	return initCrawlFetch({
		fetch: stubFetch,
		personas: [{ name: "test", headers: { "user-agent": "test" } }],
		isBlocked: () => false,
	});
}

describe("initCrawlFetch", () => {
	it("throws when referer is passed in both `referer` field and `headers`", async () => {
		const crawlFetch = createCrawlFetch();
		await assert.rejects(
			() =>
				crawlFetch("https://example.com", {
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
			fetchH2: stillRateLimited,
			fetchCurl: stillRateLimited,
			rateLimitRetryDelaysMs: [1],
		});

		const response = await crawlFetch("https://example.com");

		assert.equal(response.status, 200);
		assert.equal(await response.text(), "ok");
		assert.equal(primaryCalls, 2);
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
		});

		const response = await crawlFetch("https://wrapper.example/link");

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
		});
		const hops: Array<{ fromUrl: string; toUrl: string }> = [];

		await crawlFetch("https://wrapper.example/link", { onRedirect: (hop) => hops.push(hop) });

		assert.deepEqual(hops, [
			{ fromUrl: "https://wrapper.example/link", toUrl: "https://dest.example/article" },
		]);
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
			fetchH2: neverCalled,
			fetchCurl: neverCalled,
		});

		const response = await crawlFetch("https://example.com");

		assert.equal(response.status, 200);
		assert.equal(await response.text(), "ok");
		assert.deepEqual(userAgents, ["Blocked/1.0", "Allowed/1.0"]);
	});
});
