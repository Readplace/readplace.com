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
import { initReadabilityParser } from "@packages/article-parser";
import { useTestServer } from "../../../test-app";
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

async function openReaderHarness(opts: { ready: boolean; query?: string }) {
	const crawlArticle = async () => ({ status: "fetched" as const, html: ARTICLE_HTML, bodyHash: "a".repeat(64) });
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const { parseArticle } = initReadabilityParser({ crawlArticle, siteRules: [], logError: createNoopLogError() });
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
		.set("Cookie", sessionCookie);
	expect(response.status).toBe(200);
	return { document: new JSDOM(response.text).window.document, harness, fixture, sessionCookie, articleId };
}

async function openReader(opts: { ready: boolean; query?: string }): Promise<Document> {
	return (await openReaderHarness(opts)).document;
}

function downloadsSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-downloads-slot]");
	assert(slot, "the downloads slot must render");
	return slot;
}

describe("GET /queue/:id/view Download", () => {
	it.each(["", "?feature=other", "?platform=ios", "?platform=android"])("hides ready downloads without the EPUB feature: %s", async (query) => {
		const doc = await openReader({ ready: true, query });

		expect(downloadsSlot(doc).classList.contains("article-body__downloads-slot--hidden")).toBe(true);
	});

	it("links to public EPUB and AZW3 URLs when the article is ready", async () => {
		const doc = await openReader({ ready: true, query: "?feature=epub" });

		expect(downloadsSlot(doc).classList.contains("article-body__downloads-slot--visible")).toBe(true);
		const links = Array.from(doc.querySelectorAll("[data-test-download]"), (link) => {
			const href = new URL(link.getAttribute("href") ?? "", TEST_APP_ORIGIN);
			return {
				format: link.getAttribute("data-test-download"),
				pathname: href.pathname,
				utmSource: href.searchParams.get("utm_source"),
				utmMedium: href.searchParams.get("utm_medium"),
				utmContent: href.searchParams.get("utm_content"),
			};
		});
		expect(links).toEqual([
			{
				format: "epub",
				pathname: "/view/example.com/shareable",
				utmSource: "reader",
				utmMedium: "internal",
				utmContent: "download-epub",
			},
			{
				format: "azw3",
				pathname: "/view/example.com/shareable",
				utmSource: "reader",
				utmMedium: "internal",
				utmContent: "download-azw3",
			},
		]);
	});

	it("keeps its Download slot hidden while the article is pending", async () => {
		const doc = await openReader({ ready: false, query: "?feature=epub" });

		expect(downloadsSlot(doc).classList.contains("article-body__downloads-slot--hidden")).toBe(true);
	});

	it("offers Download in the iOS chromeless reader", async () => {
		const doc = await openReader({ ready: true, query: "?platform=ios&feature=epub" });

		expect(downloadsSlot(doc).classList.contains("article-body__downloads-slot--visible")).toBe(true);
		expect(Array.from(doc.querySelectorAll("[data-test-download]"), (link) => link.textContent)).toEqual([
			"EPUB",
			"AZW3",
		]);
	});

	it("offers Download in the Android chromeless reader", async () => {
		const doc = await openReader({ ready: true, query: "?platform=android&feature=epub" });

		expect(downloadsSlot(doc).classList.contains("article-body__downloads-slot--visible")).toBe(true);
		expect(Array.from(doc.querySelectorAll("[data-test-download]"), (link) => link.textContent)).toEqual([
			"EPUB",
			"AZW3",
		]);
	});

	it.each(["reader", "summary"])("reveals Download when the %s poll receives ready content", async (poll) => {
		const { document, harness, fixture, sessionCookie, articleId } = await openReaderHarness({ ready: false, query: "?feature=epub" });
		const initialSlot = downloadsSlot(document);
		expect(initialSlot.id).toBe("reader-downloads-slot");
		expect(initialSlot.classList.contains("article-body__downloads-slot--hidden")).toBe(true);
		const initialPollUrls = Array.from(document.querySelectorAll("#article-body-reader-slot[hx-get], #article-body-summary-slot[hx-get]"), (element) => new URL(element.getAttribute("hx-get") ?? "", TEST_APP_ORIGIN));
		expect(initialPollUrls.map((url) => url.searchParams.get("feature"))).toEqual(["epub", "epub"]);

		await fixture.articleStore.writeContent({ url: ARTICLE_URL, content: "<p>The article is ready.</p>" });
		await fixture.articleCrawl.markCrawlReady({ url: ARTICLE_URL });
		const response = await request(harness.server)
			.get(`/queue/${articleId}/${poll}?poll=1&feature=epub`)
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
			{
				format: "azw3",
				href: "/view/example.com/shareable?format=azw3&utm_source=reader&utm_medium=internal&utm_content=download-azw3",
			},
		]);
	});

	it.each(["reader", "summary"])("keeps the default %s poll scoped to the reader without downloads", async (poll) => {
		const { harness, sessionCookie, articleId } = await openReaderHarness({ ready: true });
		const response = await request(harness.server)
			.get(`/queue/${articleId}/${poll}?poll=1`)
			.set("Cookie", sessionCookie);

		expect(response.status).toBe(200);
		const document = new JSDOM(response.text).window.document;
		expect(Array.from(document.querySelectorAll("[hx-swap-oob]"), (element) => element.id)).toEqual([
			poll === "reader" ? "article-body-summary-slot" : "article-body-reader-slot",
			"article-body-progress",
			"article-header",
			"document-title",
		]);
	});
});
