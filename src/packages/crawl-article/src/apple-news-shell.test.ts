import assert from "node:assert/strict";
import { initFetchAppleNewsShell, initResolveAppleNewsStoryUrl } from "./apple-news-shell";
import type { CrawlFetch, CrawlFetchInit } from "./crawl-fetch";

const SHELL_URL = "https://apple.news/AjYm3jdR0S4uhs9hRKpJ1Sg";
const STORY_URL = "http://www.abc.net.au/news/2020-09-09/oscars-academy-sets-out-diversity-standards/12644874";

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

function stubCrawlFetch(handler: (url: string, init: CrawlFetchInit) => Response): CrawlFetch {
	return async (url, init) => handler(url, init);
}

describe("initFetchAppleNewsShell", () => {
	it("extracts the story URL from redirectToUrlAfterTimeout", async () => {
		const fetchShell = initFetchAppleNewsShell({
			crawlFetch: stubCrawlFetch(() => okHtml(shellWithRedirectScript(`redirectToUrlAfterTimeout("${STORY_URL}", 0);`))),
		});

		assert.deepEqual(await fetchShell(SHELL_URL), { kind: "story", url: STORY_URL });
	});

	it("extracts the story URL from redirectToUrl", async () => {
		const fetchShell = initFetchAppleNewsShell({
			crawlFetch: stubCrawlFetch(() => okHtml(shellWithRedirectScript(`redirectToUrl("${STORY_URL}");`))),
		});

		assert.deepEqual(await fetchShell(SHELL_URL), { kind: "story", url: STORY_URL });
	});

	it("passes the caller's abort signal and the shell budget to the crawl fetch", async () => {
		let captured: CrawlFetchInit | undefined;
		const fetchShell = initFetchAppleNewsShell({
			crawlFetch: stubCrawlFetch((_url, init) => {
				captured = init;
				return okHtml(shellWithRedirectScript(`redirectToUrl("${STORY_URL}");`));
			}),
		});
		const signal = new AbortController().signal;

		await fetchShell(SHELL_URL, { signal });

		assert(captured);
		assert.equal(captured.signal, signal);
		assert.equal(captured.budgetMs, 10000);
	});

	it("reports an unavailable shell with its status", async () => {
		const fetchShell = initFetchAppleNewsShell({
			crawlFetch: stubCrawlFetch(() => new Response(null, { status: 404 })),
		});

		assert.deepEqual(await fetchShell(SHELL_URL), { kind: "unavailable", status: 404 });
	});

	describe("reports no story URL", () => {
		const cases: Array<[string, string]> = [
			["when the shell has no navigation call", shellWithRedirectScript("")],
			["when the literal is not a URL", shellWithRedirectScript('redirectToUrl("not a url");')],
			["when the literal is not http(s)", shellWithRedirectScript('redirectToUrl("javascript:alert(1)");')],
			["when the literal stays on apple.news", shellWithRedirectScript('redirectToUrl("https://apple.news/A123");')],
			["when the literal is the apple.com placeholder root", shellWithRedirectScript('redirectToUrl("http://www.apple.com");')],
		];
		for (const [label, html] of cases) {
			it(label, async () => {
				const fetchShell = initFetchAppleNewsShell({ crawlFetch: stubCrawlFetch(() => okHtml(html)) });

				assert.deepEqual(await fetchShell(SHELL_URL), { kind: "no-story-url" });
			});
		}
	});
});

describe("initResolveAppleNewsStoryUrl", () => {
	const signal = new AbortController().signal;

	it("returns the story URL", async () => {
		const resolve = initResolveAppleNewsStoryUrl({
			crawlFetch: stubCrawlFetch(() => okHtml(shellWithRedirectScript(`redirectToUrl("${STORY_URL}");`))),
			logError: () => {},
		});

		assert.equal(await resolve(SHELL_URL, { signal }), STORY_URL);
	});

	it("returns undefined without logging when the shell carries no story URL", async () => {
		const logged: string[] = [];
		const resolve = initResolveAppleNewsStoryUrl({
			crawlFetch: stubCrawlFetch(() => okHtml(shellWithRedirectScript(""))),
			logError: (message) => logged.push(message),
		});

		assert.equal(await resolve(SHELL_URL, { signal }), undefined);
		assert.deepEqual(logged, []);
	});

	it("logs and returns undefined when the shell is unavailable", async () => {
		const logged: string[] = [];
		const resolve = initResolveAppleNewsStoryUrl({
			crawlFetch: stubCrawlFetch(() => new Response(null, { status: 503 })),
			logError: (message) => logged.push(message),
		});

		assert.equal(await resolve(SHELL_URL, { signal }), undefined);
		assert.deepEqual(logged, [`[CrawlArticle] apple.news shell HTTP 503 for ${SHELL_URL}`]);
	});

	it("propagates a failed shell fetch to the caller", async () => {
		const resolve = initResolveAppleNewsStoryUrl({
			crawlFetch: async () => {
				throw new Error("socket hang up");
			},
			logError: () => {},
		});

		await assert.rejects(() => resolve(SHELL_URL, { signal }), /socket hang up/);
	});
});
