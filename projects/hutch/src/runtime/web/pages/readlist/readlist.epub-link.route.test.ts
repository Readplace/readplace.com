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

async function openReader(opts: { ready: boolean; query?: string }): Promise<Document> {
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
	return new JSDOM(response.text).window.document;
}

function epubSlot(doc: Document): Element {
	const slot = doc.querySelector("[data-test-download-epub-slot]");
	assert(slot, "the download-epub slot must render");
	return slot;
}

describe("GET /queue/:id/view download-epub link", () => {
	it("links to the public EPUB URL when the article is ready and the feature is revealed", async () => {
		const doc = await openReader({ ready: true, query: "?feature=epub" });

		expect(epubSlot(doc).classList.contains("article-body__download-epub-slot--visible")).toBe(true);
		const link = doc.querySelector("[data-test-download-epub]");
		assert(link, "the download-epub link must render when ready");
		const href = new URL(link.getAttribute("href") ?? "", TEST_APP_ORIGIN);
		expect(href.pathname).toBe("/view/example.com/shareable");
		expect(href.searchParams.get("format")).toBe("epub");
		expect(href.searchParams.get("utm_source")).toBe("reader");
		expect(href.searchParams.get("utm_medium")).toBe("internal");
	});

	it("hides the download-epub slot when the feature is not revealed", async () => {
		const doc = await openReader({ ready: true });

		expect(epubSlot(doc).classList.contains("article-body__download-epub-slot--hidden")).toBe(true);
	});

	it("hides the download-epub slot while the article is pending", async () => {
		const doc = await openReader({ ready: false, query: "?feature=epub" });

		expect(epubSlot(doc).classList.contains("article-body__download-epub-slot--hidden")).toBe(true);
	});

	it("hides the download-epub slot in the iOS chromeless reader", async () => {
		const doc = await openReader({ ready: true, query: "?platform=ios&feature=epub" });

		expect(epubSlot(doc).classList.contains("article-body__download-epub-slot--hidden")).toBe(true);
	});
});
