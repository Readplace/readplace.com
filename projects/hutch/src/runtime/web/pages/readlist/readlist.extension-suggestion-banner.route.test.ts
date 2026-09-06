import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { BROWSER_REQUEST_HEADERS, useTestServer, loginAgent } from "../../../test-app";
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
import type { FindArticleCrawlStatus } from "@packages/test-fixtures/providers/article-crawl";
import type { FindGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";

/** Android's app is not advertised, so an Android visitor has no client the
 * banner could send them to install. */
const ANDROID_CHROME_UA =
	"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

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
	const readlistResponse = await agent.get("/queue");
	const readlistDoc = new JSDOM(readlistResponse.text).window.document;
	const id = readlistDoc
		.querySelector("[data-test-article-list] .readlist-article")
		?.getAttribute("data-test-article");
	assert(id, "saved article must appear in the readlist listing with an id");
	return id;
}

describe("GET /queue — extension suggestion banner", () => {
	/** The banner's trigger is the reader views (public /view and owner /queue/:id/view).
	 * The readlist listing never computes the banner state itself — covered here so a
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

		const response = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);

		expect(bannerAttr(response.text)).toBe("false");
	});

	it("never triggers the banner on an empty listing", async () => {
		const harness = useApp(createDefaultTestAppFixture(TEST_APP_ORIGIN));
		const agent = await loginAgent(harness.server, harness.auth);

		const response = await agent.get("/queue").set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(bannerAttr(response.text)).toBe("false");
	});
});

describe("GET /queue/:id/view — extension suggestion banner", () => {
	it("sets data-show='false' while the owned article's crawl is still pending", async () => {
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

		const response = await agent.get(`/queue/${articleId}/view`).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(bannerAttr(response.text)).toBe("false");
	});

	it("sets data-show='true' when the owned article's crawl has failed", async () => {
		const findArticleCrawlStatus: FindArticleCrawlStatus = async () => ({
			status: "failed",
			reason: "blocked",
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "skipped",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus },
			summary: { ...fixture.summary, findGeneratedSummary },
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndFindId(agent, "https://example.com/failed-read");

		const response = await agent.get(`/queue/${articleId}/view`).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		expect(bannerAttr(response.text)).toBe("true");
	});

	it("sets data-show='false' when the owned article's crawl and summary are both ready", async () => {
		const articleHtml = `<html><head><title>Done</title></head><body><article><p>Body.</p></article></body></html>`;
		const crawlArticle = async () => ({
			status: "fetched" as const,
			html: articleHtml,
			bodyHash: "a".repeat(64),
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "ready",
			summary: "TLDR.",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { parseArticle } = initReadabilityParser({
			crawlArticle,
			siteRules: [],
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
				publishLinkQueued: fixture.events.publishLinkQueued,
				publishLinkDequeued: fixture.events.publishLinkDequeued,
				publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
				publishRecrawlLinkInitiated:
					createFakePublishRecrawlLinkInitiated(applyParseResult),
				publishSaveAnonymousLink:
					createFakePublishSaveAnonymousLink(applyParseResult),
			},
			summary: { ...fixture.summary, findGeneratedSummary },
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndFindId(agent, "https://example.com/parsed-read");

		const response = await agent.get(`/queue/${articleId}/view`).set(BROWSER_REQUEST_HEADERS);

		expect(bannerAttr(response.text)).toBe("false");
	});

	it("sets data-show='true' when the crawl is ready but summary generation failed", async () => {
		const articleHtml = `<html><head><title>Failed</title></head><body><article><p>Body.</p></article></body></html>`;
		const crawlArticle = async () => ({
			status: "fetched" as const,
			html: articleHtml,
			bodyHash: "a".repeat(64),
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "failed",
			reason: "model timeout",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const { parseArticle } = initReadabilityParser({
			crawlArticle,
			siteRules: [],
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
				publishLinkQueued: fixture.events.publishLinkQueued,
				publishLinkDequeued: fixture.events.publishLinkDequeued,
				publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
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

		const response = await agent.get(`/queue/${articleId}/view`).set(BROWSER_REQUEST_HEADERS);

		expect(bannerAttr(response.text)).toBe("true");
	});

	it("reveals the banner OOB on a settled failed owner reader poll", async () => {
		const findArticleCrawlStatus: FindArticleCrawlStatus = async () => ({
			status: "failed",
			reason: "blocked",
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "skipped",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus },
			summary: { ...fixture.summary, findGeneratedSummary },
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndFindId(agent, "https://example.com/failed-poll");

		const response = await agent.get(`/queue/${articleId}/reader?poll=1`).set(BROWSER_REQUEST_HEADERS);

		expect(response.status).toBe(200);
		const banner = new JSDOM(response.text).window.document.querySelector(
			"#extension-suggestion-banner",
		);
		assert(banner, "banner OOB fragment must be present on a settled failed poll");
		expect(banner.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(banner.getAttribute("data-show-extension-suggestion")).toBe("true");
	});

	it("emits no banner OOB on a settled failed poll for a platform with no advertised client", async () => {
		const findArticleCrawlStatus: FindArticleCrawlStatus = async () => ({
			status: "failed",
			reason: "blocked",
		});
		const findGeneratedSummary: FindGeneratedSummary = async () => ({
			status: "skipped",
		});
		const fixture = createDefaultTestAppFixture(TEST_APP_ORIGIN);
		const harness = useApp({
			...fixture,
			articleCrawl: { ...fixture.articleCrawl, findArticleCrawlStatus },
			summary: { ...fixture.summary, findGeneratedSummary },
		});
		const agent = await loginAgent(harness.server, harness.auth);
		const articleId = await saveAndFindId(agent, "https://example.com/failed-poll-android");

		const response = await agent
			.get(`/queue/${articleId}/reader?poll=1`)
			.set({ ...BROWSER_REQUEST_HEADERS, "User-Agent": ANDROID_CHROME_UA });

		expect(response.status).toBe(200);
		const ids = Array.from(
			new JSDOM(response.text).window.document.querySelectorAll("[hx-swap-oob]"),
		).map((el) => el.id);
		expect(ids).not.toContain("extension-suggestion-banner");
	});

	it("emits no banner OOB while the owner reader poll is still loading", async () => {
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
		const articleId = await saveAndFindId(agent, "https://example.com/pending-poll");

		const response = await agent.get(`/queue/${articleId}/reader?poll=1`).set(BROWSER_REQUEST_HEADERS);

		const ids = Array.from(
			new JSDOM(response.text).window.document.querySelectorAll("[hx-swap-oob]"),
		).map((el) => el.id);
		expect(ids).toEqual([
			"article-body-summary-slot",
			"article-body-progress",
			"article-header",
			"document-title",
		]);
	});
});
