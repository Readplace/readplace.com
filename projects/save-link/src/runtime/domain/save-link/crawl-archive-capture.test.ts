import { SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { ArchiveCaptureCrawlFailedEvent } from "@packages/hutch-infra-components";
import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult, FinalizedArticle } from "@packages/finalize-article";
import { initCrawlArchiveCapture } from "./crawl-archive-capture";

const ORIGINAL = "https://dead.example/article";
const CAPTURE = "https://web.archive.org/web/20081203185222/https://dead.example/article";

const finalized: FinalizedArticle = {
	html: "<p>From the archive</p>",
	metadata: { title: "T", siteName: "dead.example", excerpt: "e", wordCount: 300, estimatedReadTime: 2, imageUrl: undefined },
};

function createCapture(result: CrawlAndFinalizeResult) {
	const crawls: Parameters<CrawlAndFinalizeArticle>[0][] = [];
	const putTierSource = jest.fn().mockResolvedValue(undefined);
	const publishEvent = jest.fn().mockResolvedValue(undefined);
	const logCrawlOutcome = jest.fn();
	const crawlArchiveCapture = initCrawlArchiveCapture({
		now: () => new Date("2026-04-18T12:00:00.000Z"),
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		crawlAndFinalizeArticle: async (params) => {
			crawls.push(params);
			return result;
		},
		putTierSource,
		readTierSnapshot: async () => ({ tier0Status: "not_attempted", tier1Status: "failed", pickedTier: "none" }),
		logCrawlOutcome,
		publishEvent,
		logger: noopLogger,
	});
	return { crawlArchiveCapture, crawls, putTierSource, publishEvent, logCrawlOutcome };
}

describe("initCrawlArchiveCapture", () => {
	it("crawls the capture under the original and writes it to the archive tier with the capture recorded", async () => {
		const harness = createCapture({ status: "fetched", article: finalized, bodyHash: "a".repeat(64), evaluationHtml: "<html><body><p>From the archive</p></body></html>" });

		expect(await harness.crawlArchiveCapture({ url: ORIGINAL, captureUrl: CAPTURE, saveAttemptId: SaveAttemptIdSchema.parse("attempt") })).toEqual({ id: expect.any(String), tier: "tier-2" });
		expect(harness.crawls).toEqual([{ url: ORIGINAL, fetchUrl: CAPTURE, retainResponseBody: true, writeContext: { url: ORIGINAL, attemptId: "attempt" } }]);
		expect(harness.putTierSource).toHaveBeenCalledWith({
			url: ORIGINAL,
			tier: "tier-2",
			html: finalized.html,
			metadata: expect.objectContaining({ ...finalized.metadata, sourceUrl: CAPTURE }),
			evaluationHtml: "<html><body><p>From the archive</p></body></html>",
		});
		expect(harness.logCrawlOutcome).toHaveBeenCalledWith({
			url: ORIGINAL,
			thisTier: "tier-2",
			thisTierStatus: "success",
			otherTierStatus: "failed",
			pickedTier: "none",
		});
		expect(harness.publishEvent).not.toHaveBeenCalled();
	});

	it.each<{ result: CrawlAndFinalizeResult; reason: string }>([
		{ result: { status: "failed", reason: "crawl-failed" }, reason: "failed: crawl-failed" },
		{ result: { status: "unsupported", reason: "application/pdf" }, reason: "unsupported: application/pdf" },
		{ result: { status: "not-found", httpStatus: 404 }, reason: "not-found" },
		{ result: { status: "blocked", httpStatus: 429 }, reason: "blocked" },
		{ result: { status: "not-modified" }, reason: "not-modified" },
	])("records a capture the archive would not serve ($reason) as a failure fact and writes nothing", async ({ result, reason }) => {
		const harness = createCapture(result);

		expect(await harness.crawlArchiveCapture({ url: ORIGINAL, captureUrl: CAPTURE, saveAttemptId: SaveAttemptIdSchema.parse("attempt") })).toBeUndefined();
		expect(harness.putTierSource).not.toHaveBeenCalled();
		expect(harness.publishEvent).toHaveBeenCalledWith(ArchiveCaptureCrawlFailedEvent, { url: ORIGINAL, captureUrl: CAPTURE, reason });
		expect(harness.logCrawlOutcome).toHaveBeenCalledWith(expect.objectContaining({ thisTier: "tier-2", thisTierStatus: "failed" }));
	});
});

it("rejects a legacy queued capture whose original does not match the adopted identity", async () => {
	const crawlAndFinalizeArticle = jest.fn();
	const publishEvent = jest.fn().mockResolvedValue(undefined);
	const crawl = initCrawlArchiveCapture({ crawlAndFinalizeArticle, putTierSource: async () => {}, readTierSnapshot: async () => ({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }), logCrawlOutcome: () => {}, logger: noopLogger, now: () => new Date(), verifyWrapperSource: async () => undefined, publishEvent });
	expect(await crawl({ url: ORIGINAL, captureUrl: CAPTURE, saveAttemptId: SaveAttemptIdSchema.parse("legacy-attempt") })).toBeUndefined();
	expect(crawlAndFinalizeArticle).not.toHaveBeenCalled();
	expect(publishEvent).toHaveBeenCalledWith(ArchiveCaptureCrawlFailedEvent, { url: ORIGINAL, captureUrl: CAPTURE, reason: "unverified source identity" });
});
