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
		let calls = 0;
		const rateLimitedFetch: typeof fetch = async () => {
			calls += 1;
			return calls === 1 ? new Response("slow down", { status: 429 }) : new Response("ok");
		};
		const crawlFetch = initCrawlFetch({
			fetch: rateLimitedFetch,
			personas: [{ name: "test", headers: { "user-agent": "test" } }],
			isBlocked: () => false,
			rateLimitRetryDelaysMs: [1],
		});

		const response = await crawlFetch("https://example.com");

		assert.equal(response.status, 200);
		assert.equal(await response.text(), "ok");
		assert.equal(calls, 2);
	});
});
