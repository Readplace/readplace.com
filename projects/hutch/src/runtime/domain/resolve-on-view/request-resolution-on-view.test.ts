import { ANONYMOUS_VIEWER, SaveAttemptIdSchema, type ShownSummary, shownSummary } from "@packages/domain/article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { initInMemoryArticleCrawl, initInMemoryClaimResolutionOnView } from "@packages/test-fixtures/providers/article-crawl";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { initInMemoryResolveArticleOnView } from "@packages/test-fixtures/providers/events";
import { initRequestResolutionOnView, overlayResolution } from "./request-resolution-on-view";

const AWAITING = JSON.stringify({ kind: "awaiting-reader", deferredLeg: "comprehensive" });
const EDGE_BLOCK = JSON.stringify({ kind: "blocked", cause: "edge-block" });

function setup(overrides: { publishFails?: boolean } = {}) {
	const crawl = initInMemoryArticleCrawl();
	const summary = initInMemoryGeneratedSummary({ findItemOwner: async () => undefined });
	const claimResolutionOnView = initInMemoryClaimResolutionOnView({ crawl, summary, findItemOwner: async () => undefined });
	const publisher = initInMemoryResolveArticleOnView({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } });
	const logger: HutchLogger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
	const publishError = new Error("eventbridge down");
	const requestResolutionOnView = initRequestResolutionOnView({
		claimResolutionOnView,
		publishResolveArticleOnView: overrides.publishFails
			? async () => {
					throw publishError;
				}
			: publisher.publishResolveArticleOnView,
		findArticleCrawlStatus: crawl.findArticleCrawlStatus,
		findGeneratedSummary: summary.findGeneratedSummary,
		logger,
	});
	const rowOf = async (url: string) => ({
		url,
		crawl: await crawl.findArticleCrawlStatus(url),
		summary: await summary.findGeneratedSummary({ url, viewer: ANONYMOUS_VIEWER }),
	});
	return { crawl, summary, publisher, logger, publishError, requestResolutionOnView, rowOf };
}

describe("initRequestResolutionOnView", () => {
	it("claims a parked crawl, publishes one crawl-and-summary command, and returns the pending state", async () => {
		const t = setup();
		const url = "https://example.com/parked";
		await t.crawl.markCrawlUnsupported({ url, reason: AWAITING });
		await t.summary.markSummarySkipped({ url, reason: "awaiting-reader" });

		const resolved = await t.requestResolutionOnView({
			surface: "readlist-html",
			viewer: ANONYMOUS_VIEWER,
			viewerCanCapture: false,
			articles: [await t.rowOf(url)],
		});

		expect(resolved.get(url)?.crawl).toEqual({ status: "pending" });
		expect(resolved.get(url)?.summary).toEqual({ status: "pending" });
		expect(t.publisher.publishedResolveArticleOnView).toEqual([
			{ url, axes: "crawl-and-summary", surface: "readlist-html", saveAttemptId: expect.any(String) },
		]);
		expect(SaveAttemptIdSchema.safeParse(t.publisher.publishedResolveArticleOnView[0]?.saveAttemptId).success).toBe(true);
	});

	it("claims only the summary of a ready crawl whose summary failed", async () => {
		const t = setup();
		const url = "https://example.com/summary-failed";
		await t.crawl.markCrawlReady({ url });
		await t.summary.markSummaryFailed({ url, reason: "boom" });

		const resolved = await t.requestResolutionOnView({
			surface: "reader",
			viewer: ANONYMOUS_VIEWER,
			viewerCanCapture: true,
			articles: [await t.rowOf(url)],
		});

		expect(resolved.get(url)).toEqual({ crawl: { status: "ready" }, summary: { status: "pending" } });
		expect(t.publisher.publishedResolveArticleOnView).toEqual([
			{ url, axes: "summary", surface: "reader", saveAttemptId: expect.any(String) },
		]);
	});

	it("leaves a device-first row and a settled row untouched and publishes nothing for them", async () => {
		const t = setup();
		const blocked = "https://example.com/blocked";
		const settled = "https://example.com/settled";
		await t.crawl.markCrawlFailed({ url: blocked, reason: EDGE_BLOCK });
		await t.crawl.markCrawlReady({ url: settled });
		await t.summary.markSummaryReady({ url: settled, summary: "s" });

		const resolved = await t.requestResolutionOnView({
			surface: "readlist-siren",
			viewer: ANONYMOUS_VIEWER,
			viewerCanCapture: true,
			articles: [await t.rowOf(blocked), await t.rowOf(settled)],
		});

		expect(resolved.size).toBe(0);
		expect(t.publisher.publishedResolveArticleOnView).toEqual([]);
		expect(t.logger.info).toHaveBeenCalledWith("[ResolveOnView] requested", {
			surface: "readlist-siren",
			viewerCanCapture: true,
			seen: 2,
			eligible: 0,
			deviceFirst: 1,
			claimed: 0,
			lostRace: 0,
		});
	});

	it("re-reads the row when another tab already claimed it, so the losing tab renders pending too", async () => {
		const t = setup();
		const url = "https://example.com/raced";
		await t.crawl.markCrawlUnsupported({ url, reason: AWAITING });
		await t.summary.markSummarySkipped({ url, reason: "awaiting-reader" });
		const staleRow = await t.rowOf(url);
		await t.requestResolutionOnView({ surface: "reader", viewer: ANONYMOUS_VIEWER, viewerCanCapture: false, articles: [staleRow] });

		const resolved = await t.requestResolutionOnView({
			surface: "readlist-html",
			viewer: ANONYMOUS_VIEWER,
			viewerCanCapture: false,
			articles: [staleRow],
		});

		expect(resolved.get(url)).toEqual({ crawl: { status: "pending" }, summary: { status: "pending" } });
		expect(t.publisher.publishedResolveArticleOnView).toHaveLength(1);
		expect(t.logger.info).toHaveBeenLastCalledWith("[ResolveOnView] requested", {
			surface: "readlist-html",
			viewerCanCapture: false,
			seen: 1,
			eligible: 1,
			deviceFirst: 0,
			claimed: 0,
			lostRace: 1,
		});
	});

	it("logs a publish failure without rethrowing and still returns the claimed state", async () => {
		const t = setup({ publishFails: true });
		const url = "https://example.com/publish-fails";
		await t.crawl.markCrawlFailed({ url, reason: EDGE_BLOCK });

		const resolved = await t.requestResolutionOnView({
			surface: "queue-digest",
			viewer: ANONYMOUS_VIEWER,
			viewerCanCapture: false,
			articles: [await t.rowOf(url)],
		});

		expect(resolved.get(url)?.crawl).toEqual({ status: "pending" });
		expect(t.logger.error).toHaveBeenCalledWith("[ResolveOnView] publish failed", {
			url,
			axes: "crawl-and-summary",
			surface: "queue-digest",
			error: t.publishError,
		});
		expect(t.logger.info).toHaveBeenCalledWith("[ResolveOnView] requested", {
			surface: "queue-digest",
			viewerCanCapture: false,
			seen: 1,
			eligible: 1,
			deviceFirst: 0,
			claimed: 1,
			lostRace: 0,
		});
	});
});

describe("overlayResolution", () => {
	it("replaces the resolved urls' crawl and summary and keeps every other url as loaded", () => {
		const pending: ArticleCrawl = { status: "pending" };
		const ready: ArticleCrawl = { status: "ready" };
		const failedSummary = shownSummary({ url: "https://b.example/", summary: { status: "failed", reason: "boom" }, viewer: ANONYMOUS_VIEWER, ownerUserId: undefined });
		const crawlByUrl = new Map<string, ArticleCrawl | undefined>([
			["https://a.example/", { status: "unsupported", reason: AWAITING }],
			["https://b.example/", ready],
		]);
		const summaryByUrl = new Map<string, ShownSummary | undefined>([
			["https://a.example/", undefined],
			["https://b.example/", failedSummary],
		]);

		const overlaid = overlayResolution(crawlByUrl, summaryByUrl, new Map([["https://a.example/", { crawl: pending, summary: undefined }]]));

		expect(overlaid.crawlByUrl).toEqual(new Map<string, ArticleCrawl | undefined>([["https://a.example/", pending], ["https://b.example/", ready]]));
		expect(overlaid.summaryByUrl).toEqual(new Map<string, ShownSummary | undefined>([["https://a.example/", undefined], ["https://b.example/", failedSummary]]));
		expect(crawlByUrl.get("https://a.example/")).toEqual({ status: "unsupported", reason: AWAITING });
	});
});
