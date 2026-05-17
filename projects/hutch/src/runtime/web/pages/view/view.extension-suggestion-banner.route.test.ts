import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import request from "supertest";
import type {
	ParseArticle,
	ParseArticleResult,
} from "@packages/test-fixtures/providers/article-parser";
import type { FindArticleCrawlStatus } from "@packages/test-fixtures/providers/article-crawl";
import type { FindGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { useTestServer } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
} from "@packages/test-fixtures";

const ARTICLE_URL = "https://example.com/post";
const ENCODED = encodeURIComponent(ARTICLE_URL);

type OkParseResult = Extract<ParseArticleResult, { ok: true }>;
type ParsedArticle = OkParseResult["article"];

function buildParseResult(
	overrides: Partial<ParsedArticle> = {},
): ParseArticleResult {
	return {
		ok: true,
		article: {
			title: "Hello World",
			siteName: "example.com",
			excerpt: "A lovely article.",
			wordCount: 500,
			content: "<p>Body copy.</p>",
			imageUrl: "https://cdn.example.com/hero.jpg",
			...overrides,
		},
	};
}

function bannerAttr(html: string): string | null {
	const doc = new JSDOM(html).window.document;
	const banner = doc.querySelector("[data-test-extension-suggestion-banner]");
	assert(banner, "extension suggestion banner element must always be present");
	return banner.getAttribute("data-show-extension-suggestion");
}

const useApp = useTestServer();

describe("GET /view/{url} — extension suggestion banner", () => {
	it("sets data-show='true' when no crawl/summary exists yet (anonymous first hit)", async () => {
		const parseArticle: ParseArticle = async () => buildParseResult();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const findArticleCrawlStatus: FindArticleCrawlStatus = async () => undefined;
		const findGeneratedSummary: FindGeneratedSummary = async () => undefined;
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
			articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus },
			summary: { ...fixture.summary, findGeneratedSummary },
		});

		const response = await request(harness.server).get(`/view/${ENCODED}`);

		expect(response.status).toBe(200);
		expect(bannerAttr(response.text)).toBe("true");
	});

	it("sets data-show='false' when both crawl and summary are ready (fully parsed)", async () => {
		const parseArticle: ParseArticle = async () => buildParseResult();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const applyParseResult = createFakeApplyParseResult({
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parseArticle,
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "ready",
			summary: "TLDR.",
		});
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
			events: {
				...fixture.events,
				publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
				publishRecrawlLinkInitiated:
					createFakePublishRecrawlLinkInitiated(applyParseResult),
				publishSaveAnonymousLink:
					createFakePublishSaveAnonymousLink(applyParseResult),
			},
			summary: { ...fixture.summary, findGeneratedSummary },
		});

		const response = await request(harness.server).get(`/view/${ENCODED}`);

		expect(bannerAttr(response.text)).toBe("false");
	});

	it("sets data-show='true' when crawl is ready but summary is still pending", async () => {
		const parseArticle: ParseArticle = async () => buildParseResult();
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const applyParseResult = createFakeApplyParseResult({
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parseArticle,
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "pending",
		});
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle: fixture.parser.crawlArticle },
			events: {
				...fixture.events,
				publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
				publishRecrawlLinkInitiated:
					createFakePublishRecrawlLinkInitiated(applyParseResult),
				publishSaveAnonymousLink:
					createFakePublishSaveAnonymousLink(applyParseResult),
			},
			summary: { ...fixture.summary, findGeneratedSummary },
		});

		const response = await request(harness.server).get(`/view/${ENCODED}`);

		expect(bannerAttr(response.text)).toBe("true");
	});
});
