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

async function saveAndFindId(
	agent: ReturnType<typeof loginAgent> extends Promise<infer A> ? A : never,
	url: string,
): Promise<string> {
	await agent.post("/queue/save").type("form").send({ url });
	const queueResponse = await agent.get("/queue");
	const queueDoc = new JSDOM(queueResponse.text).window.document;
	const id = queueDoc
		.querySelector("[data-test-article-list] .queue-article")
		?.getAttribute("data-test-article");
	assert(id, "saved article must appear in the queue listing with an id");
	return id;
}

describe("GET /queue — extension suggestion banner", () => {
	/** The banner's trigger is the reader views (public /view and owner /queue/:id/read).
	 * The queue listing never computes the banner state itself — covered here so a
	 * future change that re-introduces a /queue trigger surfaces as a failing test
	 * instead of silently re-coupling the listing to article parse state. */
	it("never triggers the banner on the listing, even when the most recent save is pending", async () => {
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

		expect(bannerAttr(response.text)).toBe("false");
	});

	it("never triggers the banner on an empty listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue");

		expect(response.status).toBe(200);
		expect(bannerAttr(response.text)).toBe("false");
	});
});

describe("GET /queue/:id/read — extension suggestion banner", () => {
	it("sets data-show='true' when the owned article's crawl is still pending", async () => {
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
		const articleId = await saveAndFindId(agent, "https://example.com/pending-read");

		const response = await agent.get(`/queue/${articleId}/read`);

		expect(response.status).toBe(200);
		expect(bannerAttr(response.text)).toBe("true");
	});

	it("sets data-show='false' when the owned article's crawl and summary are both ready", async () => {
		const articleHtml = `<html><head><title>Done</title></head><body><article><p>Body.</p></article></body></html>`;
		const crawlArticle = async () => ({
			status: "fetched" as const,
			html: articleHtml,
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "ready",
			summary: "TLDR.",
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
		const articleId = await saveAndFindId(agent, "https://example.com/parsed-read");

		const response = await agent.get(`/queue/${articleId}/read`);

		expect(bannerAttr(response.text)).toBe("false");
	});

	it("sets data-show='true' when the crawl is ready but summary generation failed", async () => {
		const articleHtml = `<html><head><title>Failed</title></head><body><article><p>Body.</p></article></body></html>`;
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
		const articleId = await saveAndFindId(
			agent,
			"https://example.com/summary-failed-read",
		);

		const response = await agent.get(`/queue/${articleId}/read`);

		expect(bannerAttr(response.text)).toBe("true");
	});
});
