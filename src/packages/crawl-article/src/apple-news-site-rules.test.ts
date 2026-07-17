import type { CrawlFetch } from "./crawl-fetch";
import { initAppleNewsSiteRules } from "./apple-news-site-rules";

const noopLogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

function shellWithRedirectScript(navigationCalls: string): string {
	return [
		'<!DOCTYPE html><html><head><script type="text/javascript">',
		navigationCalls,
		"function redirectToUrl(url) { top.location.replace(url); }",
		"function redirectToUrlAfterTimeout(url, timeout) { setTimeout(function() { redirectToUrl(url) }, timeout); }",
		"</script><title>Story</title></head>",
		"<body><h1>Opening story…</h1></body></html>",
	].join("\n");
}

const okHtml = (html: string): Response =>
	new Response(html, { status: 200, headers: { "content-type": "text/html" } });

describe("appleNewsSiteRules.matches", () => {
	const site = initAppleNewsSiteRules({
		crawlFetch: stubCrawlFetch(() => new Response()),
		logError: noopLogError,
	});

	it("matches apple.news URLs", () => {
		expect(site.matches({ url: "https://apple.news/A-KY3k0aRSK27SNKVtrWiDg", hostname: "apple.news" })).toBe(true);
	});

	it("matches www.apple.news URLs", () => {
		expect(site.matches({ url: "https://www.apple.news/A-KY3k0aRSK27SNKVtrWiDg", hostname: "www.apple.news" })).toBe(true);
	});

	it("does not match unrelated origins", () => {
		expect(site.matches({ url: "https://example.com/foo", hostname: "example.com" })).toBe(false);
	});
});

describe("appleNewsSiteRules.onCrawl", () => {
	it("fetches the shell and redirects to the story URL in redirectToUrlAfterTimeout", async () => {
		const storyUrl = "https://www.theguardian.com/law/article/2024/may/23/redistricting-case?CMP=oth_b-aplnews_d-1";
		let capturedUrl = "";
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async (url) => {
				capturedUrl = url;
				return okHtml(shellWithRedirectScript(`redirectToUrlAfterTimeout("${storyUrl}", 0);`));
			}),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A-KY3k0aRSK27SNKVtrWiDg" });

		expect(result).toEqual({ kind: "redirect", url: storyUrl });
		expect(capturedUrl).toBe("https://apple.news/A-KY3k0aRSK27SNKVtrWiDg");
	});

	it("redirects to the story URL in a plain redirectToUrl call", async () => {
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () =>
				okHtml(shellWithRedirectScript('redirectToUrl("https://example.com/story");')),
			),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "redirect", url: "https://example.com/story" });
	});

	it("fails closed when the shell only defines the redirect functions without calling them", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () => okHtml(shellWithRedirectScript(""))),
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/TgpculELoRG6kU30aUngQFw" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell carries no story URL for https://apple.news/TgpculELoRG6kU30aUngQFw",
		);
	});

	it("fails closed when the embedded story URL is not parseable", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () => okHtml(shellWithRedirectScript('redirectToUrl("not a url");'))),
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell carries no story URL for https://apple.news/A123",
		);
	});

	it("fails closed when the embedded story URL is not http(s)", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () => okHtml(shellWithRedirectScript('redirectToUrl("javascript:alert(1)");'))),
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell carries no story URL for https://apple.news/A123",
		);
	});

	it("fails closed when the embedded story URL points back at apple.news", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () =>
				okHtml(shellWithRedirectScript('redirectToUrlAfterTimeout("https://apple.news/A999", 0);')),
			),
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell carries no story URL for https://apple.news/A123",
		);
	});

	it("fails closed on the bare origin placeholder Apple emits for stories without a public web URL", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () =>
				okHtml(shellWithRedirectScript('redirectToUrlAfterTimeout("http://www.apple.com", 0);')),
			),
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A5vHgPPmQSvuIxPjeXLTdGQ" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell carries no story URL for https://apple.news/A5vHgPPmQSvuIxPjeXLTdGQ",
		);
	});

	it("redirects to a root-path story URL when it carries a query string", async () => {
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () =>
				okHtml(shellWithRedirectScript('redirectToUrl("https://example.com/?p=123");')),
			),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "redirect", url: "https://example.com/?p=123" });
	});

	it("fails closed and logs status when the shell responds non-ok", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(async () => new Response(null, { status: 404 })),
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] apple.news shell HTTP 404 for https://apple.news/A123");
	});

	it("fails closed and logs the error when crawlFetch throws", async () => {
		const networkError = new Error("network down");
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: async () => {
				throw networkError;
			},
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell fetch error for https://apple.news/A123",
			networkError,
		);
	});

	it("fails closed and logs an undefined error when crawlFetch rejects with a non-Error value", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: async () => {
				throw "string error";
			},
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/A123" });

		expect(result).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell fetch error for https://apple.news/A123",
			undefined,
		);
	});
});
