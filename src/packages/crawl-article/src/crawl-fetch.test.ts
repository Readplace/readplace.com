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
});
