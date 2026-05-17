import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { useTestServer, loginAgent } from "../../../test-app";
import {
	TEST_APP_ORIGIN,
	createDefaultTestAppFixture,
	createFakeApplyParseResult,
	createFakePublishLinkSaved,
	createFakePublishRecrawlLinkInitiated,
	createFakePublishSaveAnonymousLink,
	createNoopLogError,
	initReadabilityParser,
} from "@packages/test-fixtures";
import type { FindArticleCrawlStatus } from "@packages/test-fixtures/providers/article-crawl";
import type { FindGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";

const useApp = useTestServer();

function bannerAttr(html: string): string | null {
	const doc = new JSDOM(html).window.document;
	const banner = doc.querySelector("[data-test-extension-suggestion-banner]");
	assert(banner, "extension suggestion banner element must always be present");
	return banner.getAttribute("data-show-extension-suggestion");
}

describe("GET /queue — extension suggestion banner", () => {
	it("sets data-show='false' for an empty queue (no saves to evaluate)", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		expect(bannerAttr(response.text)).toBe("false");
	});

	it("sets data-show='true' when the most recent save is still pending", async () => {
		const findArticleCrawlStatus: FindArticleCrawlStatus = async () => ({
			status: "pending",
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "pending",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus },
			summary: { ...fixture.summary, findGeneratedSummary },
		});
		const agent = await loginAgent(harness.server, harness.auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/pending" });

		const response = await agent.get("/queue");

		expect(bannerAttr(response.text)).toBe("true");
	});

	it("sets data-show='false' when the most recent save has both crawl and summary ready", async () => {
		const articleHtml = `<html><head><title>Post</title></head><body><article><p>Body.</p></article></body></html>`;
		const crawlArticle = async () => ({
			status: "fetched" as const,
			html: articleHtml,
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "ready",
			summary: "Done.",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { parseArticle } = initReadabilityParser({
			crawlArticle,
			sitePreParsers: [],
			logError: createNoopLogError(),
		});
		const applyParseResult = createFakeApplyParseResult({
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parseArticle,
		});
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle },
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
		const agent = await loginAgent(harness.server, harness.auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/parsed" });

		const response = await agent.get("/queue");

		expect(bannerAttr(response.text)).toBe("false");
	});

	it("sets data-show='true' when the crawl is ready but summary generation failed", async () => {
		const articleHtml = `<html><head><title>Post</title></head><body><article><p>Body.</p></article></body></html>`;
		const crawlArticle = async () => ({
			status: "fetched" as const,
			html: articleHtml,
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "failed",
			reason: "model timeout",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { parseArticle } = initReadabilityParser({
			crawlArticle,
			sitePreParsers: [],
			logError: createNoopLogError(),
		});
		const applyParseResult = createFakeApplyParseResult({
			articleStore: fixture.articleStore,
			articleCrawl: fixture.articleCrawl,
			parseArticle,
		});
		const harness = useApp({
			...fixture,
			parser: { parseArticle, crawlArticle },
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
		const agent = await loginAgent(harness.server, harness.auth);

		await agent
			.post("/queue/save")
			.type("form")
			.send({ url: "https://example.com/summary-failed" });

		const response = await agent.get("/queue");

		expect(bannerAttr(response.text)).toBe("true");
	});
});
