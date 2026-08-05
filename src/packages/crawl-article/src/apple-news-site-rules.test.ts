import { deflateSync } from "node:zlib";
import type { CrawlFetch } from "./crawl-fetch";
import { initAppleNewsSiteRules } from "./apple-news-site-rules";

const noopLogError = () => {};

function stubCrawlFetch(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return async (url) => handler(url);
}

/* Every shell-path test routes the Apple News Format handle to a 404 so the
 * shell branch under test is the only thing that decides the outcome. */
function stubShellOnly(handler: (url: string) => Promise<Response> | Response): CrawlFetch {
	return stubCrawlFetch((url) =>
		url.startsWith("https://c.apple.news/") ? new Response(null, { status: 404 }) : handler(url),
	);
}

const anfOk = (document: unknown): Response =>
	new Response(deflateSync(Buffer.from(JSON.stringify(document))), { status: 200 });

const ANF_DOCUMENT = { title: "Tom Holland", components: [{ role: "body", text: "The interview." }] };

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
		crawlFetch: stubShellOnly(() => new Response()),
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
			crawlFetch: stubShellOnly(async (url) => {
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
			crawlFetch: stubShellOnly(async () =>
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
			crawlFetch: stubShellOnly(async () => okHtml(shellWithRedirectScript(""))),
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
			crawlFetch: stubShellOnly(async () => okHtml(shellWithRedirectScript('redirectToUrl("not a url");'))),
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
			crawlFetch: stubShellOnly(async () => okHtml(shellWithRedirectScript('redirectToUrl("javascript:alert(1)");'))),
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
			crawlFetch: stubShellOnly(async () =>
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
			crawlFetch: stubShellOnly(async () =>
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
			crawlFetch: stubShellOnly(async () =>
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
			crawlFetch: stubShellOnly(async () => new Response(null, { status: 404 })),
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

describe("appleNewsSiteRules Apple News Format body", () => {
	it("supplies the Apple News Format body when the shell carries no story URL", async () => {
		const logError = jest.fn();
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch((url) =>
				url.startsWith("https://c.apple.news/") ? anfOk(ANF_DOCUMENT) : okHtml(shellWithRedirectScript("")),
			),
			logError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA" });

		expect(result).toEqual({
			kind: "content",
			html:
				"<html><head><title>Tom Holland</title>" +
				'<meta property="og:image" content="https://c.apple.news/AgEXQWJ4UGdRUWRwUVN5LUVSeDJnLWtRWkEAMA"></head>' +
				'<body><article><h1>Tom Holland</h1><img src="https://c.apple.news/AgEXQWJ4UGdRUWRwUVN5LUVSeDJnLWtRWkEAMA" alt=""/>' +
				"<p>The interview.</p></article></body></html>",
		});
		expect(logError).not.toHaveBeenCalledWith(
			"[CrawlArticle] apple.news shell carries no story URL for https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA",
		);
	});

	it("prefers the publisher redirect over the Apple News Format body when the shell carries a story URL", async () => {
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch((url) =>
				url.startsWith("https://c.apple.news/")
					? anfOk(ANF_DOCUMENT)
					: okHtml(shellWithRedirectScript('redirectToUrl("https://example.com/story");')),
			),
			logError: noopLogError,
		});

		const result = await site.onCrawl({ url: "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA" });

		expect(result).toEqual({ kind: "redirect", url: "https://example.com/story" });
	});

	it("recovers the Apple News Format body for a story whose publisher refused the crawl", async () => {
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(() => anfOk(ANF_DOCUMENT)),
			logError: noopLogError,
		});

		const recovered = await site.recoverContent({ url: "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA" });

		expect(recovered).toContain("<p>The interview.</p>");
	});

	it("recovers nothing when Apple holds no document for the story", async () => {
		const site = initAppleNewsSiteRules({
			crawlFetch: stubCrawlFetch(() => new Response(null, { status: 404 })),
			logError: noopLogError,
		});

		const recovered = await site.recoverContent({ url: "https://apple.news/AbxPgQQdpQSy-ERx2g-kQZA" });

		expect(recovered).toBeUndefined();
	});
});
