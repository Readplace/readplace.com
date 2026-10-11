import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { OFFLINE_BANNER_TEXT } from "@packages/web-shell";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
} from "@packages/test-fixtures";
import type { TestAppFixture } from "@packages/test-fixtures";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { loginAgent, useTestServer } from "../../../test-app";
import { ARTICLE_VERSION_HEADER } from "../../shared/offline-reader/offline-cache";

const useApp = useTestServer();

const FIXED_NOW = new Date("2026-04-25T12:00:00.000Z");

const OFFLINE_READER_BUNDLE = "/client-dist/offline-reader.client.js";

const ARTICLE_HTML = `
<html><head><title>Offline Post</title></head>
<body><article>
	<h1>Offline Post</h1>
	<p>Long enough body text for the readability parser to extract a clean article from.</p>
	<p>A second paragraph so the parser has more than the minimum word count to work with.</p>
</article></body></html>`;

const BOOSTED_HEADERS = {
	"HX-Request": "true",
	"HX-Boosted": "true",
	"HX-Current-URL": `${TEST_APP_ORIGIN}/queue`,
};

function buildFixture(now: () => Date): TestAppFixture {
	const crawlArticle = async () => ({
		status: "fetched" as const,
		html: ARTICLE_HTML,
		bodyHash: "sha256-stub",
	});
	const base = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({
		crawlArticle,
		siteRules: [],
		readabilityAdditions,
		logError: createNoopLogError(),
	});
	const applyParseResult = createFakeApplyParseResult({
		articleStore: base.articleStore,
		articleCrawl: base.articleCrawl,
		parseArticle,
	});
	return {
		...base,
		shared: { ...base.shared, now },
		parser: { parseArticle, crawlArticle },
		summary: {
			...base.summary,
			findGeneratedSummary: async () => ({
				status: "ready",
				summary: "A concise summary.",
				excerpt: "Lead line.",
			}),
		},
		events: {
			...base.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
	};
}

async function savedReader(url: string) {
	const fixture = buildFixture(() => FIXED_NOW);
	const harness = useApp(fixture);
	const agent = await loginAgent(harness.server, harness.auth);
	await agent.post("/queue/save").type("form").send({ url });
	const user = await harness.auth.findUserByEmail("test@example.com");
	assert(user, "the logged-in user must exist");
	await fixture.relatedArticles.markRelatedArticlesSkipped({ userId: user.userId, url, at: FIXED_NOW });
	const doc = new JSDOM((await agent.get("/queue")).text).window.document;
	const href = doc.querySelector("[data-test-article-title]")?.getAttribute("href");
	assert(href, "the card must link into the reader");
	return { agent, readerHref: href };
}

function wholeDocument(html: string): Document {
	assert(html.startsWith("<!DOCTYPE html>"), "the response must be a whole HTML document");
	return new JSDOM(html).window.document;
}

function bundleSrcs(html: string): string[] {
	return Array.from(new JSDOM(html).window.document.querySelectorAll("script[src]"))
		.map((element) => element.getAttribute("src") ?? "")
		.filter((src) => src.startsWith("/client-dist/"));
}

describe("what the offline reader worker may keep (GET /queue, GET /queue/:id/view)", () => {
	it("answers a boosted reader open with the same whole page a plain navigation gets", async () => {
		const { agent, readerHref } = await savedReader("https://example.com/offline-boosted-reader");

		const navigated = await agent.get(readerHref);
		const boosted = await agent.get(readerHref).set(BOOSTED_HEADERS);

		expect(boosted.status).toBe(200);
		expect(boosted.headers["content-type"]).toBe("text/html; charset=utf-8");
		assert(navigated.headers.etag?.startsWith('W/"'), "the reader must carry a body-derived ETag");
		expect(boosted.headers.etag).toBe(navigated.headers.etag);
		expect(wholeDocument(boosted.text).body.classList.contains("page-reader")).toBe(true);
	});

	it.each([
		"/queue",
		"/queue?tab=done",
		"/queue?order=asc&utm_source=header-nav&utm_medium=internal&utm_content=readlist",
	])("answers a boosted request for %s with the same whole page a plain navigation gets", async (path) => {
		const { agent } = await savedReader("https://example.com/offline-boosted-listing");

		const navigated = await agent.get(path);
		const boosted = await agent.get(path).set(BOOSTED_HEADERS);

		expect(boosted.status).toBe(200);
		expect(boosted.headers["content-type"]).toBe("text/html; charset=utf-8");
		assert(navigated.headers.etag?.startsWith('W/"'), "the listing must carry a body-derived ETag");
		expect(boosted.headers.etag).toBe(navigated.headers.etag);
		expect(wholeDocument(boosted.text).body.classList.contains("page-readlist")).toBe(true);
	});
});

const MINUTE_MS = 60 * 1000;

function nextReadStatus(html: string): string | null {
	const slot = new JSDOM(html).window.document.querySelector("[data-test-reader-related]");
	assert(slot, "the reader must render its Next read slot");
	return slot.getAttribute("data-related-status");
}

describe("the article version the offline reader worker compares (GET /queue/:id/view)", () => {
	it("names one version for an unchanged article whether the download or a card asks for it, and whenever, while the page's ETag moves", async () => {
		const clock = { now: new Date() };
		const fixture = buildFixture(() => clock.now);
		const harness = useApp(fixture);
		const agent = await loginAgent(harness.server, harness.auth);
		const sourceUrl = "https://example.com/offline-version-source";
		const relatedUrl = "https://example.com/offline-version-related";
		await agent.post("/queue/save").type("form").send({ url: relatedUrl });
		await agent.post("/queue/save").type("form").send({ url: sourceUrl });
		const user = await harness.auth.findUserByEmail("test@example.com");
		assert(user, "the logged-in user must exist");
		await fixture.relatedArticles.markRelatedArticlesReady({
			userId: user.userId,
			url: sourceUrl,
			relatedArticles: [{ url: relatedUrl, reason: "Same topic." }],
			inputTokens: 0,
			outputTokens: 0,
			at: clock.now,
		});
		const source = await fixture.articleStore.findArticleByUrl(sourceUrl);
		assert(source, "saving the source url must create an article row");
		const listing = new JSDOM((await agent.get("/queue")).text).window.document;
		const cardHref = listing
			.querySelector(`[data-test-article="${source.id.value}"] [data-test-article-title]`)
			?.getAttribute("href");
		assert(cardHref, "the source article's card must link into the reader");
		const version = new URL(cardHref, TEST_APP_ORIGIN).searchParams.get("v");
		assert(version, "the card must name the article version it links to");

		clock.now = new Date(clock.now.getTime() + 20 * MINUTE_MS);
		const downloaded = await agent
			.get(`/queue/${source.id.value}/view?v=${version}`)
			.set({ Purpose: "prefetch", Accept: "text/html" });
		const opened = await agent.get(cardHref);
		clock.now = new Date(clock.now.getTime() + 40 * MINUTE_MS);
		const reopened = await agent.get(cardHref);
		const renders = [downloaded, opened, reopened];

		expect(renders.map((render) => render.status)).toEqual([200, 200, 200]);
		expect(renders.map((render) => nextReadStatus(render.text))).toEqual(["ready", "ready", "ready"]);
		expect(renders.map((render) => render.headers[ARTICLE_VERSION_HEADER.toLowerCase()])).toEqual([
			version,
			version,
			version,
		]);
		expect(new Set(renders.map((render) => render.headers.etag)).size).toBe(renders.length);
	});
});

describe("offline reader registration", () => {
	it("ships the registration on the readlist", async () => {
		const { agent } = await savedReader("https://example.com/offline-script-readlist");

		const srcs = bundleSrcs((await agent.get("/queue")).text);

		expect(srcs.filter((src) => src === OFFLINE_READER_BUNDLE)).toEqual([OFFLINE_READER_BUNDLE]);
	});

	it("ships the registration on the reader", async () => {
		const { agent, readerHref } = await savedReader("https://example.com/offline-script-reader");

		const srcs = bundleSrcs((await agent.get(readerHref)).text);

		expect(srcs.filter((src) => src === OFFLINE_READER_BUNDLE)).toEqual([OFFLINE_READER_BUNDLE]);
	});

	it.each(["ios", "android"])(
		"keeps the registration off the %s app's chromeless reader, whose native sign-out never sends the storage purge the web logout does",
		async (platform) => {
			const { agent, readerHref } = await savedReader(`https://example.com/offline-script-chromeless-${platform}`);

			const html = (await agent.get(`${readerHref}&platform=${platform}`)).text;

			expect(new JSDOM(html).window.document.body.classList.contains("page-reader--chromeless")).toBe(true);
			expect(bundleSrcs(html).filter((src) => src === OFFLINE_READER_BUNDLE)).toEqual([]);
		},
	);
});

const SAVED_AT = "2026-10-04T12:00:00.000Z";

function runningPage(input: { html: string; path: string }): JSDOM {
	return new JSDOM(input.html, { url: `${TEST_APP_ORIGIN}${input.path}`, runScripts: "dangerously" });
}

function recordCopy(dom: JSDOM, copy: { path: string }): Promise<void> {
	dom.window.document.documentElement.setAttribute("data-offline-copy-path", copy.path);
	dom.window.document.documentElement.setAttribute("data-offline-copy-saved-at", SAVED_AT);
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function drawerRowKeys(dom: JSDOM): string[] {
	return Array.from(dom.window.document.querySelectorAll(".crawl-bookmark__tab"), (tab) =>
		String(tab.getAttribute("data-test-crawl-bookmark-tab")),
	);
}

function rowScriptNonce(html: string): string | null {
	const scripts = Array.from(new JSDOM(html).window.document.querySelectorAll("script:not([src])"));
	const rowScript = scripts.find((script) => script.textContent?.includes("data-offline-copy-row"));
	assert(rowScript, "the page must carry the offline copy row script");
	return rowScript.getAttribute("nonce");
}

function pageNonce(html: string): string | null {
	const style = new JSDOM(html).window.document.querySelector("style[nonce]");
	assert(style, "the page must render its nonce'd stylesheet");
	return style.getAttribute("nonce");
}

describe("the stored copy's row in the crawl drawer", () => {
	it("tops the drawer of a reader page the worker kept once the shell records the copy, under the page's nonce", async () => {
		const { agent, readerHref } = await savedReader("https://example.com/offline-row-reader");
		const html = (await agent.get(readerHref)).text;
		const readerPath = new URL(readerHref, TEST_APP_ORIGIN).pathname;
		const reader = runningPage({ html, path: readerHref });

		await recordCopy(reader, { path: readerPath });

		expect(drawerRowKeys(reader)[0]).toBe("offline");
		expect(rowScriptNonce(html)).toBe(pageNonce(html));
		reader.window.close();
	});

	it("tops the drawer of a reader a boosted open swaps into the readlist, under the readlist's nonce", async () => {
		const { agent, readerHref } = await savedReader("https://example.com/offline-row-boosted");
		const listHtml = (await agent.get("/queue")).text;
		const readerMain = new JSDOM((await agent.get(readerHref)).text).window.document.querySelector("main");
		assert(readerMain, "the reader page must render its main");
		const readlist = runningPage({ html: listHtml, path: "/queue" });
		const { document, history, Event } = readlist.window;

		history.pushState({}, "", readerHref);
		const listMain = document.querySelector("main");
		assert(listMain, "the readlist must render its main");
		listMain.outerHTML = readerMain.outerHTML;
		document.querySelector("main")?.dispatchEvent(new Event("htmx:afterSwap", { bubbles: true }));
		await recordCopy(readlist, { path: new URL(readerHref, TEST_APP_ORIGIN).pathname });

		expect(drawerRowKeys(readlist)[0]).toBe("offline");
		expect(rowScriptNonce(listHtml)).toBe(pageNonce(listHtml));
		readlist.window.close();
	});
});

const NAVIGATION = "Not implemented: navigation (except hash changes)";

function cardOpenScriptNonce(html: string): string | null {
	const scripts = Array.from(new JSDOM(html).window.document.querySelectorAll("script:not([src])"));
	const cardOpenScript = scripts.find((script) => script.textContent?.includes("data-opens-reader"));
	assert(cardOpenScript, "the page must carry the card open script");
	return cardOpenScript.getAttribute("nonce");
}

describe("a card tap on a listing whose htmx never loaded (GET /queue served from the worker's copy)", () => {
	it("keeps the list on screen and raises the shell's offline banner, under the page's nonce, when the article cannot be reached", async () => {
		const { agent } = await savedReader("https://example.com/offline-tap-unreachable");
		const html = (await agent.get("/queue")).text;
		const navigations: string[] = [];
		const virtualConsole = new VirtualConsole();
		virtualConsole.on("jsdomError", (error) => {
			if (error.message === NAVIGATION) navigations.push(error.message);
		});
		const listing = new JSDOM(html, {
			url: `${TEST_APP_ORIGIN}/queue`,
			runScripts: "dangerously",
			virtualConsole,
			beforeParse(window) {
				Object.defineProperty(window, "fetch", { value: () => Promise.reject(new TypeError("Failed to fetch")) });
			},
		});
		const { document, MouseEvent } = listing.window;
		const card = document.querySelector("main [data-test-article-title]");
		assert(card, "the listing must render the saved article's card");
		const banner = document.querySelector(".offline-banner");
		assert(banner, "the shell must render the offline banner");
		expect(banner.getAttribute("aria-hidden")).toBe("true");

		card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(banner.getAttribute("aria-hidden")).toBe("false");
		expect(banner.textContent).toBe(OFFLINE_BANNER_TEXT);
		expect(navigations).toEqual([]);
		expect(document.querySelector("main [data-test-article-title]")).toBe(card);
		expect(cardOpenScriptNonce(html)).toBe(pageNonce(html));
		listing.window.close();
	});
});
