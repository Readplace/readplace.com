import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
} from "@packages/test-fixtures";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { BROWSER_REQUEST_HEADERS, useTestServer } from "../../../test-app";
import { SESSION_COOKIE_NAME } from "@packages/web-session";

const ARTICLE_URL = "https://example.com/shareable";
const ARTICLE_HTML = `
<html><head><title>Shareable</title></head>
<body><article>
	<h1>Shareable</h1>
	<p>Body copy that easily clears the readability threshold check.</p>
	<p>A second paragraph adds enough words for the parser to succeed.</p>
</article></body></html>`;

const useApp = useTestServer();

async function openReaderHarness(opts: { ready: boolean; query?: string; headers?: Record<string, string> }) {
	const crawlArticle = async () => ({ status: "fetched" as const, html: ARTICLE_HTML, bodyHash: "a".repeat(64) });
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: createNoopLogError() });
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	const noop = async () => {};
	const harness = useApp({
		...fixture,
		parser: { parseArticle, crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: opts.ready ? createFakePublishLinkSaved(applyParseResult) : noop,
			publishRecrawlLinkInitiated: opts.ready ? createFakePublishRecrawlLinkInitiated(applyParseResult) : noop,
			publishSaveAnonymousLink: opts.ready ? createFakePublishSaveAnonymousLink(applyParseResult) : noop,
		},
	});

	const created = await harness.auth.createUser({ email: "test@example.com", password: "password123" });
	assert(created.ok, "test user must be created");
	const sessionId = await harness.auth.createSession({ userId: created.userId, emailVerified: true });
	const sessionCookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

	await request(harness.server).post("/queue/save").set("Cookie", sessionCookie).type("form").send({ url: ARTICLE_URL });
	const readlistDoc = new JSDOM((await request(harness.server).get("/queue").set("Cookie", sessionCookie)).text).window
		.document;
	const articleId = readlistDoc
		.querySelector("[data-test-article-list] .readlist-article")
		?.getAttribute("data-test-article");
	assert(articleId, "saved article must surface in the readlist");

	const response = await request(harness.server)
		.get(`/queue/${articleId}/view${opts.query ?? ""}`)
		.set(opts.headers ?? {})
		.set("Cookie", sessionCookie);
	expect(response.status).toBe(200);
	return { document: new JSDOM(response.text).window.document, harness, fixture, sessionCookie, articleId };
}

async function openReader(opts: { ready: boolean; query?: string; headers?: Record<string, string> }): Promise<Document> {
	return (await openReaderHarness(opts)).document;
}

function downloadsSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-downloads-slot]");
	assert(slot, "the downloads slot must render");
	return slot;
}

describe("GET /queue/:id/view Download", () => {
	it.each([
		{ query: "", appClient: null },
		{ query: "?platform=ios", appClient: "ios_app" },
		{ query: "?platform=android", appClient: "android_app" },
		{ query: "?shell=app", appClient: "ios_app" },
	])("offers the EPUB download on every ready surface: $query", async ({ query, appClient }) => {
		const doc = await openReader({ ready: true, query });

		expect(downloadsSlot(doc).classList.contains("article-body__downloads-slot--visible")).toBe(true);
		const links = Array.from(doc.querySelectorAll("[data-test-download]"), (link) => {
			const href = new URL(link.getAttribute("href") ?? "", TEST_APP_ORIGIN);
			return {
				format: link.getAttribute("data-test-download"),
				className: link.className,
				label: link.textContent,
				spokenOnly: link.querySelector(".sr-only")?.textContent,
				pathname: href.pathname,
				utmSource: href.searchParams.get("utm_source"),
				utmMedium: href.searchParams.get("utm_medium"),
				utmContent: href.searchParams.get("utm_content"),
				utmTerm: href.searchParams.get("utm_term"),
			};
		});
		expect(links).toEqual([
			{
				format: "epub",
				className: "btn btn--neutral btn--icon article-body__download",
				label: "Download EPUB",
				spokenOnly: "Download EPUB",
				pathname: "/view/example.com/shareable",
				utmSource: "reader",
				utmMedium: "internal",
				utmContent: "download-epub",
				utmTerm: appClient,
			},
		]);
	});

	it.each(["reader", "summary"])("preserves the iOS app attribution when the %s poll reveals Download", async (poll) => {
		const { harness, fixture, sessionCookie, articleId } = await openReaderHarness({ ready: false, query: "?platform=ios" });
		await fixture.articleStore.writeContent({ url: ARTICLE_URL, content: "<p>The article is ready.</p>" });
		await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
		const response = await request(harness.server)
			.get(`/queue/${articleId}/${poll}?poll=1&platform=ios`)
			.set("Cookie", sessionCookie);

		expect(response.status).toBe(200);
		const slot = downloadsSlot(new JSDOM(response.text).window.document);
		expect(slot.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(Array.from(slot.querySelectorAll("[data-test-download]"), (link) => link.getAttribute("href"))).toEqual([
			"/view/example.com/shareable?format=epub&utm_source=reader&utm_medium=internal&utm_content=download-epub&utm_term=ios_app",
		]);
	});

	it("keeps its Download slot hidden while the article is pending", async () => {
		const doc = await openReader({ ready: false });

		expect(downloadsSlot(doc).classList.contains("article-body__downloads-slot--hidden")).toBe(true);
	});

	it.each(["reader", "summary"])("reveals Download when the %s poll receives ready content", async (poll) => {
		const { document, harness, fixture, sessionCookie, articleId } = await openReaderHarness({ ready: false });
		const initialSlot = downloadsSlot(document);
		expect(initialSlot.id).toBe("reader-downloads-slot");
		expect(initialSlot.classList.contains("article-body__downloads-slot--hidden")).toBe(true);

		await fixture.articleStore.writeContent({ url: ARTICLE_URL, content: "<p>The article is ready.</p>" });
		await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
		const response = await request(harness.server)
			.get(`/queue/${articleId}/${poll}?poll=1`)
			.set("Cookie", sessionCookie);

		expect(response.status).toBe(200);
		const slot = downloadsSlot(new JSDOM(response.text).window.document);
		expect(slot.id).toBe(initialSlot.id);
		expect(slot.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(slot.classList.contains("article-body__downloads-slot--visible")).toBe(true);
		expect(Array.from(slot.querySelectorAll("[data-test-download]"), (link) => ({
			format: link.getAttribute("data-test-download"),
			href: link.getAttribute("href"),
		}))).toEqual([
			{
				format: "epub",
				href: "/view/example.com/shareable?format=epub&utm_source=reader&utm_medium=internal&utm_content=download-epub",
			},
		]);
	});

	it.each([
		{ poll: "reader", settledSiblingOob: ["article-body-summary-slot", "table-of-contents"] },
		{ poll: "summary", settledSiblingOob: [] },
	])("swaps the Download slot alongside the $poll poll on a ready article", async ({ poll, settledSiblingOob }) => {
		const { harness, sessionCookie, articleId } = await openReaderHarness({ ready: true });
		const response = await request(harness.server)
			.get(`/queue/${articleId}/${poll}?poll=1`)
			.set("Cookie", sessionCookie);

		expect(response.status).toBe(200);
		const document = new JSDOM(response.text).window.document;
		expect(Array.from(document.querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual([
			...settledSiblingOob,
			"article-header",
			"document-title",
			"reader-downloads-slot",
			"article-body-reader-notice",
		]);
	});
});

const MACOS_HEADERS = {
	...BROWSER_REQUEST_HEADERS,
	"User-Agent":
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
};

const OWNER_EPUB_HREF =
	"/view/example.com/shareable?format=epub&utm_source=reader&utm_medium=internal&utm_content=download-epub";

function slotShape(doc: Document) {
	const slot = downloadsSlot(doc);
	return {
		children: Array.from(slot.children, (child) => child.tagName),
		opener: slot.querySelector('[data-test-action="download-open"]')?.getAttribute("popovertarget"),
	};
}

function epubLinks(doc: Document) {
	return Array.from(doc.querySelectorAll('[data-test-download="epub"]'), (link) => ({
		inDialog: link.closest('[data-test-confirm-popover="download-guide"]') !== null,
		href: link.getAttribute("href"),
	}));
}

describe("GET /queue/:id/view Download on a platform with no EPUB reader", () => {
	it("opens a guide naming Windows before the download, and holds the download in the guide", async () => {
		const doc = await openReader({ ready: true, headers: BROWSER_REQUEST_HEADERS });

		expect(slotShape(doc)).toEqual({ children: ["BUTTON", "DETAILS"], opener: "reader-download-guide" });
		const dialog = doc.querySelector('[data-test-confirm-popover="download-guide"]');
		assert(dialog, "the reader must carry the download guide");
		expect(dialog.querySelector(".confirm-popover__title")?.textContent).toBe("Reading an EPUB on Windows");
		expect(epubLinks(doc)).toEqual([{ inDialog: true, href: OWNER_EPUB_HREF }]);
		expect(dialog.querySelector("[data-test-download-learn-more]")?.getAttribute("href")).toBe(
			"/blog/read-your-saved-articles-on-a-kindle-or-kobo?utm_source=reader&utm_medium=internal&utm_content=epub-guide-kindle-kobo",
		);
	});

	it("already holds the guide while the article is pending, so the poll that reveals Download finds it", async () => {
		const doc = await openReader({ ready: false, headers: BROWSER_REQUEST_HEADERS });

		expect([
			downloadsSlot(doc).classList.contains("article-body__downloads-slot--hidden"),
			Array.from(doc.querySelectorAll("[data-test-confirm-popover]"), (panel) =>
				panel.getAttribute("data-test-confirm-popover"),
			).includes("download-guide"),
		]).toEqual([true, true]);
	});

	it.each([
		{ surface: "the iOS app on a Windows UA", query: "?platform=ios", headers: BROWSER_REQUEST_HEADERS, utmTerm: "&utm_term=ios_app" },
		{ surface: "the Android app on a Windows UA", query: "?platform=android", headers: BROWSER_REQUEST_HEADERS, utmTerm: "&utm_term=android_app" },
		{ surface: "the app shell on a Windows UA", query: "?shell=app", headers: BROWSER_REQUEST_HEADERS, utmTerm: "&utm_term=ios_app" },
		{ surface: "a Mac browser", query: "", headers: MACOS_HEADERS, utmTerm: "" },
	])("keeps the bare download link for $surface", async ({ query, headers, utmTerm }) => {
		const doc = await openReader({ ready: true, query, headers });

		expect(slotShape(doc)).toEqual({ children: ["A"], opener: undefined });
		expect(epubLinks(doc)).toEqual([{ inDialog: false, href: `${OWNER_EPUB_HREF}${utmTerm}` }]);
		expect(
			Array.from(doc.querySelectorAll("[data-test-confirm-popover]"), (panel) =>
				panel.getAttribute("data-test-confirm-popover"),
			).includes("download-guide"),
		).toBe(false);
	});

	it.each([
		{ poll: "reader", settledSiblingOob: ["article-body-summary-slot", "table-of-contents"] },
		{ poll: "summary", settledSiblingOob: [] },
	])("re-renders the guide's opener when the $poll poll swaps the slot", async ({ poll, settledSiblingOob }) => {
		const { harness, sessionCookie, articleId } = await openReaderHarness({ ready: true, headers: BROWSER_REQUEST_HEADERS });
		const response = await request(harness.server)
			.get(`/queue/${articleId}/${poll}?poll=1`)
			.set(BROWSER_REQUEST_HEADERS)
			.set("Cookie", sessionCookie);

		expect(response.status).toBe(200);
		expect(response.headers.vary).toContain("User-Agent");
		const document = new JSDOM(response.text).window.document;
		expect(Array.from(document.querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual([
			...settledSiblingOob,
			"article-header",
			"document-title",
			"reader-downloads-slot",
			"article-body-reader-notice",
		]);
		expect(slotShape(document)).toEqual({ children: ["BUTTON", "DETAILS"], opener: "reader-download-guide" });
	});
});
