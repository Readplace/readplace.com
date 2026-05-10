import assert from "node:assert";
import { initCrawlFetch } from "./crawl-fetch";

const stubFetch: typeof fetch = async () => new Response("ok");

function createCrawlFetch() {
	return initCrawlFetch({
		fetch: stubFetch,
		defaultHeaders: { "user-agent": "test" },
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
});
