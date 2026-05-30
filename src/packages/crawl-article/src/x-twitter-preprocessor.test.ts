import { createHash } from "node:crypto";
import type { CrawlFetch } from "./crawl-fetch";
import { initFetchTweetViaOembed, isTweetUrl } from "./x-twitter-preprocessor";

const noopLogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

describe("isTweetUrl", () => {
	it("matches x.com URLs", () => {
		expect(isTweetUrl("https://x.com/user/status/123")).toBe(true);
	});

	it("matches twitter.com URLs", () => {
		expect(isTweetUrl("https://twitter.com/user/status/123")).toBe(true);
	});

	it("does not match unrelated origins", () => {
		expect(isTweetUrl("https://example.com/foo")).toBe(false);
	});
});

describe("initFetchTweetViaOembed", () => {
	it("returns synthesised HTML wrapping author name and embed for a 200 oembed response", async () => {
		const crawlFetch = stubCrawlFetch(async () =>
			new Response(JSON.stringify({
				author_name: "Elon Musk",
				html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n',
			}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError: noopLogError });

		const result = await fetchTweet({ url: "https://x.com/elonmusk/status/1519480761749016577" });

		const expectedHtml = '<html><head><title>Elon Musk</title></head><body><blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n</body></html>';
		expect(result).toEqual({
			status: "fetched",
			html: expectedHtml,
			bodyHash: createHash("sha256").update(expectedHtml).digest("hex"),
		});
	});

	it("uses empty strings when the oembed payload omits author_name and html", async () => {
		const crawlFetch = stubCrawlFetch(async () =>
			new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
		);
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError: noopLogError });

		const result = await fetchTweet({ url: "https://twitter.com/user/status/123" });

		const expectedHtml = "<html><head><title></title></head><body></body></html>";
		expect(result).toEqual({
			status: "fetched",
			html: expectedHtml,
			bodyHash: createHash("sha256").update(expectedHtml).digest("hex"),
		});
	});

	it("returns 'failed' and logs status when oembed responds non-ok", async () => {
		const crawlFetch = stubCrawlFetch(async () => new Response(null, { status: 404 }));
		const logError = jest.fn();
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError });

		const result = await fetchTweet({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed HTTP 404 for https://x.com/user/status/123");
	});

	it("returns 'failed' and logs the error when crawlFetch throws", async () => {
		const networkError = new Error("network down");
		const crawlFetch: CrawlFetch = async () => { throw networkError; };
		const logError = jest.fn();
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError });

		const result = await fetchTweet({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed error for https://x.com/user/status/123", networkError);
	});

	it("returns 'failed' and logs an undefined error when crawlFetch rejects with a non-Error value", async () => {
		const crawlFetch: CrawlFetch = async () => { throw "string error"; };
		const logError = jest.fn();
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError });

		const result = await fetchTweet({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ status: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed error for https://x.com/user/status/123", undefined);
	});

	it("canonicalises the tweet URL — strips query string before calling oembed", async () => {
		let capturedUrl = "";
		const crawlFetch = stubCrawlFetch(async (url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ author_name: "", html: "" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		});
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError: noopLogError });

		await fetchTweet({ url: "https://x.com/user/status/123?ref=test" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F123");
	});

	it("canonicalises the tweet URL — strips /video/<n>?s=<n> sub-path that oembed 404s on", async () => {
		let capturedUrl = "";
		const crawlFetch = stubCrawlFetch(async (url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ author_name: "", html: "" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		});
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError: noopLogError });

		await fetchTweet({ url: "https://x.com/AnatoliKopadze/status/2057105488165163198/video/1?s=46" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2FAnatoliKopadze%2Fstatus%2F2057105488165163198");
	});

	it("falls back to the raw URL when canonicalisation cannot find a /status/<id> segment", async () => {
		let capturedUrl = "";
		const crawlFetch = stubCrawlFetch(async (url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ author_name: "", html: "" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		});
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError: noopLogError });

		await fetchTweet({ url: "https://x.com/user/profile" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fprofile");
	});

	it("falls back to the raw URL when the input cannot be parsed as a URL", async () => {
		let capturedUrl = "";
		const crawlFetch = stubCrawlFetch(async (url) => {
			capturedUrl = url;
			return new Response(JSON.stringify({ author_name: "", html: "" }), {
				status: 200, headers: { "content-type": "application/json" },
			});
		});
		const fetchTweet = initFetchTweetViaOembed({ crawlFetch, logError: noopLogError });

		await fetchTweet({ url: "not a url" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=not%20a%20url");
	});
});
