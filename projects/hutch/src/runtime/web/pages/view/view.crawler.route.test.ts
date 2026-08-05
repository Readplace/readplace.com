import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type {
	ParseArticle,
	ParseArticleResult,
} from "@packages/article-parser";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
} from "@packages/test-fixtures";

const CRAWLER_UA = "python-requests/2.31.0";
const CANONICAL_PATH = "example.com/post";

const useApp = useTestServer();

function buildParseResult(): ParseArticleResult {
	return {
		ok: true,
		article: {
			title: "Hello World",
			siteName: "example.com",
			excerpt: "A lovely article.",
			wordCount: 500,
			content: "<p>Body copy.</p>",
			imageUrl: "https://cdn.example.com/hero.jpg",
		},
	};
}

function buildCrawlerHarness() {
	const parseArticle: ParseArticle = async () => buildParseResult();
	const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
	const applyParseResult = createFakeApplyParseResult({
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		parseArticle,
	});
	return useApp({
		...fixture,
		parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
		events: {
			...fixture.events,
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
		},
	});
}

describe("GET /view/<canonical-url> fetched by a crawler", () => {
	it("exposes the article body as document text a Readability-style extractor can reach", async () => {
		const harness = buildCrawlerHarness();

		const response = await request(harness.server)
			.get(`/view/${CANONICAL_PATH}`)
			.set("User-Agent", CRAWLER_UA);

		expect(response.status).toBe(200);
		const doc = new JSDOM(response.text).window.document;
		const readerSlot = doc.querySelector("[data-test-reader-slot]");
		assert(readerSlot, "reader slot must be rendered");
		expect(readerSlot.getAttribute("data-reader-status")).toBe("ready");

		const visibleText = doc.body.textContent;
		assert(visibleText, "document must render text");
		assert(
			visibleText.includes("Body copy."),
			`a crawler cannot crawl the article: the reader reports ready, but the body is absent from the document text a DOM/Readability extractor reads. Crawler-visible reader slot text: ${JSON.stringify(readerSlot.textContent?.trim())}`,
		);
	});
});
