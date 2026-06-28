import type { CrawlFetch } from "./crawl-fetch";
import { initXTwitterSiteRules } from "./x-twitter-site-rules";

const noopLogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

const okJson = (payload: unknown): Response =>
	new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

describe("xTwitterSiteRules.matches", () => {
	const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(() => new Response()), logError: noopLogError });

	it("matches x.com URLs", () => {
		expect(site.matches({ url: "https://x.com/user/status/123", hostname: "x.com" })).toBe(true);
	});

	it("matches twitter.com URLs", () => {
		expect(site.matches({ url: "https://twitter.com/user/status/123", hostname: "twitter.com" })).toBe(true);
	});

	it("does not match unrelated origins", () => {
		expect(site.matches({ url: "https://example.com/foo", hostname: "example.com" })).toBe(false);
	});
});

describe("xTwitterSiteRules.onCrawl", () => {
	it("returns synthesised content wrapping author name and embed for a 200 oembed response", async () => {
		const oembedPayload = {
			author_name: "Elon Musk",
			html: '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n',
		};
		const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(async () => okJson(oembedPayload)), logError: noopLogError });

		const result = await site.onCrawl({ url: "https://x.com/elonmusk/status/1519480761749016577" });

		expect(result).toEqual({
			kind: "content",
			html: '<html><head><title>Elon Musk</title></head><body><blockquote class="twitter-tweet"><p lang="en" dir="ltr">Test tweet</p></blockquote>\n</body></html>',
		});
	});

	it("uses empty strings when the oembed payload omits author_name and html", async () => {
		const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(async () => okJson({})), logError: noopLogError });

		const result = await site.onCrawl({ url: "https://twitter.com/user/status/123" });

		expect(result).toEqual({ kind: "content", html: "<html><head><title></title></head><body></body></html>" });
	});

	it("fails closed and logs status when oembed responds non-ok", async () => {
		const logError = jest.fn();
		const site = initXTwitterSiteRules({ crawlFetch: stubCrawlFetch(async () => new Response(null, { status: 404 })), logError });

		const result = await site.onCrawl({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed HTTP 404 for https://x.com/user/status/123");
	});

	it("fails closed and logs the error when crawlFetch throws", async () => {
		const networkError = new Error("network down");
		const logError = jest.fn();
		const site = initXTwitterSiteRules({ crawlFetch: async () => { throw networkError; }, logError });

		const result = await site.onCrawl({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed error for https://x.com/user/status/123", networkError);
	});

	it("fails closed and logs an undefined error when crawlFetch rejects with a non-Error value", async () => {
		const logError = jest.fn();
		const site = initXTwitterSiteRules({ crawlFetch: async () => { throw "string error"; }, logError });

		const result = await site.onCrawl({ url: "https://x.com/user/status/123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] oembed error for https://x.com/user/status/123", undefined);
	});

	it("canonicalises the tweet URL — strips query string before calling oembed", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "https://x.com/user/status/123?ref=test" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fstatus%2F123");
	});

	it("canonicalises the tweet URL — strips /video/<n>?s=<n> sub-path that oembed 404s on", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "https://x.com/AnatoliKopadze/status/2057105488165163198/video/1?s=46" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2FAnatoliKopadze%2Fstatus%2F2057105488165163198");
	});

	it("falls back to the raw URL when canonicalisation cannot find a /status/<id> segment", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "https://x.com/user/profile" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=https%3A%2F%2Fx.com%2Fuser%2Fprofile");
	});

	it("falls back to the raw URL when the input cannot be parsed as a URL", async () => {
		let capturedUrl = "";
		const site = initXTwitterSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => { capturedUrl = url; return okJson({ author_name: "", html: "" }); }),
			logError: noopLogError,
		});

		await site.onCrawl({ url: "not a url" });

		expect(capturedUrl).toBe("https://publish.twitter.com/oembed?url=not%20a%20url");
	});
});
