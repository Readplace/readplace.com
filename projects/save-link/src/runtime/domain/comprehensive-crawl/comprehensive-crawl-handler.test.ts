import { noopLogger } from "@packages/hutch-logger";
import type { CrawlArticle } from "@packages/crawl-article";
import {
	markCrawlBlocked,
	markCrawlFailed,
	markCrawlNotFound,
	markCrawlUnsupported,
} from "@packages/domain/article-aggregate";
import {
	RecrawlContentExtractedEvent,
	RefreshContentExtractedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import { initComprehensiveCrawlHandler } from "./comprehensive-crawl-handler";
import type { FinalizeArticle, FinalizedArticle } from "@packages/finalize-article";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(
	detail: {
		url: string;
		userId?: string;
		recrawl?: boolean;
		refresh?: boolean;
		previousBodyHash?: string;
	},
	opts: { receiveCount?: number } = {},
): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: { ...stubAttributes, ApproximateReceiveCount: String(opts.receiveCount ?? 1) },
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:ComprehensiveCrawlCommand",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const successfulComprehensiveCrawl: CrawlArticle = async () => ({
	status: "fetched",
	html: "<html><body><p>Extracted PDF content</p></body></html>",
	bodyHash: "a".repeat(64),
});

const stubFinalizedArticle: FinalizedArticle = {
	html: "<p>Extracted PDF content</p>",
	metadata: {
		title: "Test",
		siteName: "example.com",
		excerpt: "test",
		wordCount: 10,
		estimatedReadTime: 1,
		imageUrl: undefined,
	},
};

const okFinalize: FinalizeArticle = async () => ({ ok: true, article: stubFinalizedArticle });

type HandlerDeps = Parameters<typeof initComprehensiveCrawlHandler>[0];

const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initComprehensiveCrawlHandler({
		crawlArticle: successfulComprehensiveCrawl,
		finalizeArticle: okFinalize,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		markCrawlProgress: jest.fn().mockResolvedValue(undefined),
		consumePaidCrawlBudget: jest.fn().mockResolvedValue({ allowed: true, consumed: true }),
		refundPaidCrawlBudget: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		now: fixedNow,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		...overrides,
	});
}

describe("initComprehensiveCrawlHandler", () => {
	it("writes a tier-1 source with the finalizer's metadata and emits TierContentExtractedEvent carrying userId", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ putTierSource, publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }), buildLambdaContext(), () => {});

		expect(putTierSource).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			tier: "tier-1",
			html: stubFinalizedArticle.html,
			metadata: stubFinalizedArticle.metadata,
		});
		expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
			url: "https://example.com/doc.pdf",
			tier: "tier-1",
			userId: "user-1",
			extractedAt: "2026-04-18T12:00:00.000Z",
		});
	});

	it("folds recrawl and refresh into the adopt re-adopt guard (false on a first crawl, true on either flag)", async () => {
		const cases: Array<{ detail: { url: string; recrawl?: boolean; refresh?: boolean }; expected: boolean }> = [
			{ detail: { url: "https://example.com/doc.pdf" }, expected: false },
			{ detail: { url: "https://example.com/doc.pdf", refresh: true }, expected: true },
			{ detail: { url: "https://example.com/doc.pdf", recrawl: true }, expected: true },
		];
		for (const { detail, expected } of cases) {
			const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({ adoptCanonicalIdentity });

			await handler(createSqsEvent(detail), buildLambdaContext(), () => {});

			expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
				url: "https://example.com/doc.pdf",
				finalUrl: undefined,
				wordCount: 10,
				recrawl: expected,
			});
		}
	});

	it("threads the crawler's html + pre-fetched thumbnail into finalizeArticle (same algorithm every path uses)", async () => {
		const preFetchedThumbnail = {
			body: Buffer.from([0xff]),
			contentType: "image/jpeg",
			url: "https://example.com/og.jpg",
			extension: ".jpg",
		};
		const crawlArticle: CrawlArticle = async () => ({
			status: "fetched",
			html: "<html><body>X</body></html>",
			thumbnailImage: preFetchedThumbnail,
			bodyHash: "a".repeat(64),
		});
		const finalizeArticle = jest.fn(okFinalize);

		const handler = createHandler({ crawlArticle, finalizeArticle });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), buildLambdaContext(), () => {});

		expect(finalizeArticle).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			html: "<html><body>X</body></html>",
			preFetchedThumbnail,
		});
	});

	it("emits TierContentExtractedEvent without userId when none was provided (anonymous save path)", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), buildLambdaContext(), () => {});

		expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
			url: "https://example.com/doc.pdf",
			tier: "tier-1",
			userId: undefined,
			extractedAt: "2026-04-18T12:00:00.000Z",
		});
	});

	it("emits RecrawlContentExtractedEvent (and NOT TierContentExtractedEvent) when the command was dispatched with recrawl=true", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", recrawl: true }), buildLambdaContext(), () => {});

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, {
			url: "https://example.com/doc.pdf",
			extractedAt: "2026-04-18T12:00:00.000Z",
		});
	});

	it("short-circuits to updateFetchTimestamp (carrying forward bodyHash) when crawlArticle returns not-modified — pre-parse byte gate", async () => {
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const crawlArticle: CrawlArticle = async () => ({ status: "not-modified" });

		const handler = createHandler({
			crawlArticle,
			updateFetchTimestamp,
			publishEvent,
			putTierSource,
		});

		const result = await handler(
			createSqsEvent({
				url: "https://example.com/doc.pdf",
				refresh: true,
				previousBodyHash: "h".repeat(64),
			}),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(updateFetchTimestamp).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			contentFetchedAt: "2026-04-18T12:00:00.000Z",
			bodyHash: "h".repeat(64),
		});
		expect(publishEvent).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
	});

	it("forwards previousBodyHash from the command into the crawl call so the byte-gate can fire", async () => {
		const crawlArticle = jest.fn<Promise<{ status: "fetched"; html: string; bodyHash: string }>, Parameters<CrawlArticle>>().mockResolvedValue({
			status: "fetched",
			html: "<html><body><p>x</p></body></html>",
			bodyHash: "a".repeat(64),
		});

		const handler = createHandler({ crawlArticle: crawlArticle as unknown as CrawlArticle });

		await handler(
			createSqsEvent({
				url: "https://example.com/doc.pdf",
				refresh: true,
				previousBodyHash: "h".repeat(64),
			}),
			buildLambdaContext(),
			() => {},
		);

		expect(crawlArticle).toHaveBeenCalledWith(
			expect.objectContaining({ previousBodyHash: "h".repeat(64) }),
		);
	});

	it("emits RefreshContentExtractedEvent (with re-fetch freshness) and skips updateFetchTimestamp when refresh=true", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const crawlArticle = jest.fn().mockResolvedValue({
			status: "fetched",
			html: "<html><body><p>Refreshed PDF content</p></body></html>",
			etag: '"refreshed-pdf"',
			lastModified: "Sat, 17 May 2026 00:00:00 GMT",
			bodyHash: "deadbeef".repeat(8),
		});

		const handler = createHandler({ publishEvent, updateFetchTimestamp, crawlArticle });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", refresh: true }), buildLambdaContext(), () => {});

		expect(updateFetchTimestamp).not.toHaveBeenCalled();
		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(RefreshContentExtractedEvent, {
			url: "https://example.com/doc.pdf",
			etag: '"refreshed-pdf"',
			lastModified: "Sat, 17 May 2026 00:00:00 GMT",
			contentFetchedAt: "2026-04-18T12:00:00.000Z",
			bodyHash: "deadbeef".repeat(8),
		});
	});

	it("flips the row to terminal unsupported when crawlArticle reports unsupported (e.g. scanned PDF after OCR fallback failed)", async () => {
		const unsupportedComprehensiveCrawl: CrawlArticle = async () => ({
			status: "unsupported",
			reason: "pdf extraction failed: text-layer empty and OCR returned no text",
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			crawlArticle: unsupportedComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
			putTierSource,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/scan.pdf", userId: "user-1" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, {
			url: "https://example.com/scan.pdf",
			input: { reason: { kind: "non-html-content", contentType: "pdf extraction failed: text-layer empty and OCR returned no text" } },
		});
		expect(publishEvent).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
	});

	it("emits a tier-1 failure crawl-outcome on terminal unsupported, snapshotting the other tier's state", async () => {
		const unsupportedComprehensiveCrawl: CrawlArticle = async () => ({
			status: "unsupported",
			reason: "non-pdf body",
		});
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});

		const handler = createHandler({
			crawlArticle: unsupportedComprehensiveCrawl,
			logCrawlOutcome,
			readTierSnapshot,
		});

		await handler(createSqsEvent({ url: "https://example.com/scan.pdf" }), buildLambdaContext(), () => {});

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/scan.pdf",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});
	});

	it("throws (record routed to batchItemFailures) when crawlArticle returns 'failed' so SQS retries", async () => {
		const failingComprehensiveCrawl: CrawlArticle = async () => ({ status: "failed" });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			crawlArticle: failingComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("consumes the message (empty batchItemFailures, no SQS retry) and terminalises via markCrawlNotFound when the origin says the page is permanently gone — a retry can never resurrect a 404", async () => {
		const notFoundComprehensiveCrawl: CrawlArticle = async () => ({ status: "not-found", httpStatus: 404 });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const logParseError = jest.fn();

		const handler = createHandler({
			crawlArticle: notFoundComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
			logParseError,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/gone.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, {
			url: "https://example.com/gone.pdf",
			input: { reason: { kind: "not-found", httpStatus: 404 } },
		});
		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(publishEvent).not.toHaveBeenCalled();
		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/gone.pdf",
			reason: "crawl-not-found: HTTP 404",
		});
	});

	it("consumes the message (empty batchItemFailures, no SQS retry) and terminalises via markCrawlBlocked with cause edge-block when the origin's edge refuses this egress IP", async () => {
		const blockedComprehensiveCrawl: CrawlArticle = async () => ({ status: "blocked", httpStatus: 403 });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const logParseError = jest.fn();

		const handler = createHandler({
			crawlArticle: blockedComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
			logParseError,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/walled.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
			url: "https://example.com/walled.pdf",
			input: { reason: { kind: "blocked", cause: "edge-block" } },
		});
		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(publishEvent).not.toHaveBeenCalled();
		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/walled.pdf",
			reason: "crawl-blocked: HTTP 403",
		});
	});

	it("still consumes an edge-blocked message when the tier-1 failure outcome log fails — a telemetry hiccup must not dead-letter a row that is already terminal", async () => {
		const blockedComprehensiveCrawl: CrawlArticle = async () => ({ status: "blocked", httpStatus: 429 });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const readTierSnapshot = jest.fn().mockRejectedValue(new Error("DDB read timed out"));

		const handler = createHandler({
			crawlArticle: blockedComprehensiveCrawl,
			transitionAndPersist,
			readTierSnapshot,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/walled.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
			url: "https://example.com/walled.pdf",
			input: { reason: { kind: "blocked", cause: "rate-limited" } },
		});
	});

	it("terminalises a refresh's 404 through the same markCrawlNotFound transition — its crawl-ready guard preserves a served row while a stuck-pending row still lands terminal", async () => {
		const notFoundComprehensiveCrawl: CrawlArticle = async () => ({ status: "not-found", httpStatus: 404 });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			crawlArticle: notFoundComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/gone.pdf", refresh: true }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, {
			url: "https://example.com/gone.pdf",
			input: { reason: { kind: "not-found", httpStatus: 404 } },
		});
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("still consumes a permanently-gone message when the tier-1 failure outcome log fails — a telemetry hiccup must not dead-letter a row that is already terminal", async () => {
		const notFoundComprehensiveCrawl: CrawlArticle = async () => ({ status: "not-found", httpStatus: 404 });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const readTierSnapshot = jest.fn().mockRejectedValue(new Error("DDB read timed out"));

		const handler = createHandler({
			crawlArticle: notFoundComprehensiveCrawl,
			transitionAndPersist,
			readTierSnapshot,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/gone.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, {
			url: "https://example.com/gone.pdf",
			input: { reason: { kind: "not-found", httpStatus: 404 } },
		});
	});

	it("emits a tier-1 failure crawl-outcome on a permanently-gone page (HTTP 410), snapshotting the other tier's state", async () => {
		const notFoundComprehensiveCrawl: CrawlArticle = async () => ({ status: "not-found", httpStatus: 410 });
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});

		const handler = createHandler({
			crawlArticle: notFoundComprehensiveCrawl,
			logCrawlOutcome,
			readTierSnapshot,
		});

		await handler(createSqsEvent({ url: "https://example.com/gone.pdf" }), buildLambdaContext(), () => {});

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/gone.pdf",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});
	});

	it("routes terminal parse errors through markCrawlFailed via transitionAndPersist (same behavior as save-link-work)", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const finalizeArticle: FinalizeArticle = async () => ({ ok: false, reason: "Readability crashed on this DOM" });

		const handler = createHandler({ finalizeArticle, transitionAndPersist });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/bad.pdf",
			input: { reason: { kind: "parse-error", detail: "Readability crashed on this DOM" } },
		});
	});

	it("latches comprehensive-extracting on the first onProgress callback so the bar advances inside the extractor but later parts do not re-write the stage", async () => {
		const crawlArticle: CrawlArticle = async ({ onProgress }) => {
			if (onProgress) {
				onProgress({ partIndex: 1, partCount: 3 });
				onProgress({ partIndex: 2, partCount: 3 });
				onProgress({ partIndex: 3, partCount: 3 });
			}
			return { status: "fetched", html: "<html><body><p>x</p></body></html>", bodyHash: "a".repeat(64) };
		};
		const markCrawlStage = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			crawlArticle,
			markCrawlStage,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), buildLambdaContext(), () => {});
		await new Promise((resolve) => setImmediate(resolve));

		const extractingWrites = markCrawlStage.mock.calls.filter(
			(call) => call[0].stage === "comprehensive-extracting",
		);
		expect(extractingWrites).toHaveLength(1);
	});

	it("logs a warning and continues when the comprehensive-extracting stage write fails (best-effort beacon)", async () => {
		const crawlArticle: CrawlArticle = async ({ onProgress }) => {
			if (onProgress) onProgress({ partIndex: 1, partCount: 1 });
			await new Promise((resolve) => setImmediate(resolve));
			return { status: "fetched", html: "<html><body><p>x</p></body></html>", bodyHash: "a".repeat(64) };
		};
		const markCrawlStage = jest.fn(async ({ stage }: { stage: string }) => {
			if (stage === "comprehensive-extracting") throw new Error("DynamoDB throttled");
		});
		const warn = jest.fn();
		const logger = { ...noopLogger, warn };

		const handler = createHandler({
			crawlArticle,
			markCrawlStage,
			logger,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), buildLambdaContext(), () => {});

		expect(warn).toHaveBeenCalledWith(
			"[ComprehensiveCrawlCommand] comprehensive-extracting stage write failed",
			expect.objectContaining({
				url: "https://example.com/doc.pdf",
				error: "Error: DynamoDB throttled",
			}),
		);
	});

	it("forwards per-part progress through markCrawlProgress (the throttle's first write lands immediately so the bar moves as soon as part 1 completes)", async () => {
		const crawlArticle: CrawlArticle = async ({ onProgress }) => {
			if (onProgress) onProgress({ partIndex: 1, partCount: 5 });
			return { status: "fetched", html: "<html><body><p>x</p></body></html>", bodyHash: "a".repeat(64) };
		};
		const markCrawlProgress = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ crawlArticle, markCrawlProgress });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), buildLambdaContext(), () => {});

		expect(markCrawlProgress).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			partCurrent: 1,
			partTotal: 5,
		});
	});

	it("flushes the terminal progress value after crawlArticle returns so the final partCurrent === partTotal write always lands", async () => {
		const crawlArticle: CrawlArticle = async ({ onProgress }) => {
			if (onProgress) {
				onProgress({ partIndex: 1, partCount: 4 });
				onProgress({ partIndex: 2, partCount: 4 });
				onProgress({ partIndex: 3, partCount: 4 });
				onProgress({ partIndex: 4, partCount: 4 });
			}
			return { status: "fetched", html: "<html><body><p>x</p></body></html>", bodyHash: "a".repeat(64) };
		};
		const markCrawlProgress = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			crawlArticle,
			markCrawlProgress,
			progressIntervalMs: 10_000,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), buildLambdaContext(), () => {});

		const lastCall = markCrawlProgress.mock.calls[markCrawlProgress.mock.calls.length - 1];
		expect(lastCall[0]).toEqual({
			url: "https://example.com/doc.pdf",
			partCurrent: 4,
			partTotal: 4,
		});
	});

	it("records contentFetchedAt + etag + lastModified after a successful PDF extraction so future saves can short-circuit on TTL", async () => {
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const crawlArticle: CrawlArticle = async () => ({
			status: "fetched",
			html: "<html><body><p>x</p></body></html>",
			etag: '"pdf-abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
			bodyHash: "deadbeef".repeat(8),
		});

		const handler = createHandler({ crawlArticle, updateFetchTimestamp });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), buildLambdaContext(), () => {});

		expect(updateFetchTimestamp).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			contentFetchedAt: "2026-04-18T12:00:00.000Z",
			etag: '"pdf-abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
			bodyHash: "deadbeef".repeat(8),
		});
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const handler = createHandler();

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { wrong: "shape" } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:ComprehensiveCrawlCommand",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	describe("paid-crawl budget circuit-breaker", () => {
		it("fails the crawl gracefully past the budget: no crawl, terminal failed row, message consumed", async () => {
			const crawlArticle = jest.fn(successfulComprehensiveCrawl);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const logParseError = jest.fn();

			const handler = createHandler({
				crawlArticle,
				transitionAndPersist,
				publishEvent,
				logParseError,
				consumePaidCrawlBudget: jest.fn().mockResolvedValue({ allowed: false }),
			});

			const result = await handler(
				createSqsEvent({ url: "https://example.com/doc.pdf" }),
				buildLambdaContext(),
				() => {},
			);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(crawlArticle).not.toHaveBeenCalled();
			// One atomic cross-axis transition terminalises both axes (crawl=failed,
			// summary=skipped): the stub save left summary=pending and no
			// *-ContentExtracted event will fire here, so a partial two-write
			// terminalisation could strand the row half-terminal (the queue is
			// maxReceiveCount=1 → DLQ handler only advances crawl) and the
			// stuck-articles canary would page over a transient cap.
			expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
				url: "https://example.com/doc.pdf",
				input: { reason: { kind: "blocked", cause: "spend-capped" } },
			});
			expect(transitionAndPersist).toHaveBeenCalledTimes(1);
			expect(publishEvent).not.toHaveBeenCalled();
			expect(logParseError).toHaveBeenCalledWith({
				url: "https://example.com/doc.pdf",
				reason: "paid-crawl-budget-exhausted",
			});
		});

		it("emits a tier-1 failure crawl-outcome when the budget blocks the crawl", async () => {
			const logCrawlOutcome = jest.fn();
			const readTierSnapshot = jest.fn().mockResolvedValue({
				tier0Status: "success",
				tier1Status: "not_attempted",
				pickedTier: "tier-0",
			});

			const handler = createHandler({
				logCrawlOutcome,
				readTierSnapshot,
				consumePaidCrawlBudget: jest.fn().mockResolvedValue({ allowed: false }),
			});

			await handler(
				createSqsEvent({ url: "https://example.com/doc.pdf" }),
				buildLambdaContext(),
				() => {},
			);

			expect(logCrawlOutcome).toHaveBeenCalledWith({
				url: "https://example.com/doc.pdf",
				thisTier: "tier-1",
				thisTierStatus: "failed",
				otherTierStatus: "success",
				pickedTier: "tier-0",
			});
		});

		it("leaves a refresh's row untouched past the budget — the prior canonical keeps serving", async () => {
			const crawlArticle = jest.fn(successfulComprehensiveCrawl);
			const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
			const publishEvent = jest.fn().mockResolvedValue(undefined);

			const handler = createHandler({
				crawlArticle,
				transitionAndPersist,
				publishEvent,
				consumePaidCrawlBudget: jest.fn().mockResolvedValue({ allowed: false }),
			});

			const result = await handler(
				createSqsEvent({ url: "https://example.com/doc.pdf", refresh: true }),
				buildLambdaContext(),
				() => {},
			);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(crawlArticle).not.toHaveBeenCalled();
			expect(transitionAndPersist).not.toHaveBeenCalled();
			expect(publishEvent).not.toHaveBeenCalled();
		});

		it("runs the crawl normally while the budget allows it, keying the consume on the message id", async () => {
			const consumePaidCrawlBudget = jest.fn().mockResolvedValue({ allowed: true, consumed: true });
			const publishEvent = jest.fn().mockResolvedValue(undefined);

			const handler = createHandler({ consumePaidCrawlBudget, publishEvent });

			const result = await handler(
				createSqsEvent({ url: "https://example.com/doc.pdf" }),
				buildLambdaContext(),
				() => {},
			);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(consumePaidCrawlBudget).toHaveBeenCalledWith({ messageId: "msg-1" });
			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
				url: "https://example.com/doc.pdf",
				tier: "tier-1",
				userId: undefined,
				extractedAt: "2026-04-18T12:00:00.000Z",
			});
		});

		it("re-runs the budget gate on an SQS redelivery; an idempotent re-consume (consumed=false) still completes the crawl", async () => {
			// The provider makes a redelivered message's consume a no-op on the
			// counter (consumed=false). The handler still evaluates the gate every
			// receive rather than skipping it on ApproximateReceiveCount — so a
			// transient first-receive error can't let a later receive bypass the cap.
			const consumePaidCrawlBudget = jest.fn().mockResolvedValue({ allowed: true, consumed: false });
			const crawlArticle = jest.fn(successfulComprehensiveCrawl);
			const publishEvent = jest.fn().mockResolvedValue(undefined);

			const handler = createHandler({ consumePaidCrawlBudget, crawlArticle, publishEvent });

			const result = await handler(
				createSqsEvent({ url: "https://example.com/doc.pdf" }, { receiveCount: 2 }),
				buildLambdaContext(),
				() => {},
			);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(consumePaidCrawlBudget).toHaveBeenCalledWith({ messageId: "msg-1" });
			expect(crawlArticle).toHaveBeenCalledTimes(1);
			expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
				url: "https://example.com/doc.pdf",
				tier: "tier-1",
				userId: undefined,
				extractedAt: "2026-04-18T12:00:00.000Z",
			});
		});

		it("does not refund an idempotent re-consume (consumed=false) even when the crawl is not-modified — its slot was accounted on the first receive", async () => {
			const consumePaidCrawlBudget = jest.fn().mockResolvedValue({ allowed: true, consumed: false });
			const refundPaidCrawlBudget = jest.fn().mockResolvedValue(undefined);
			const crawlArticle: CrawlArticle = async () => ({ status: "not-modified" });

			const handler = createHandler({ consumePaidCrawlBudget, refundPaidCrawlBudget, crawlArticle });

			const result = await handler(
				createSqsEvent({
					url: "https://example.com/doc.pdf",
					refresh: true,
					previousBodyHash: "h".repeat(64),
				}, { receiveCount: 2 }),
				buildLambdaContext(),
				() => {},
			);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(refundPaidCrawlBudget).not.toHaveBeenCalled();
		});

		it("refunds the slot when the crawl short-circuits as not-modified (cheap byte-gate, no OCR/LLM spend)", async () => {
			const refundPaidCrawlBudget = jest.fn().mockResolvedValue(undefined);
			const crawlArticle: CrawlArticle = async () => ({ status: "not-modified" });

			const handler = createHandler({ refundPaidCrawlBudget, crawlArticle });

			await handler(
				createSqsEvent({
					url: "https://example.com/doc.pdf",
					refresh: true,
					previousBodyHash: "h".repeat(64),
				}),
				buildLambdaContext(),
				() => {},
			);

			expect(refundPaidCrawlBudget).toHaveBeenCalledTimes(1);
		});

		it("logs a warning and still consumes the message when the budget refund fails (best-effort, fails safe)", async () => {
			const refundPaidCrawlBudget = jest.fn().mockRejectedValue(new Error("DynamoDB throttled"));
			const crawlArticle: CrawlArticle = async () => ({ status: "not-modified" });
			const warn = jest.fn();
			const logger = { ...noopLogger, warn };

			const handler = createHandler({ refundPaidCrawlBudget, crawlArticle, logger });

			const result = await handler(
				createSqsEvent({
					url: "https://example.com/doc.pdf",
					refresh: true,
					previousBodyHash: "h".repeat(64),
				}),
				buildLambdaContext(),
				() => {},
			);

			expect(result).toEqual({ batchItemFailures: [] });
			expect(warn).toHaveBeenCalledWith(
				"[ComprehensiveCrawlCommand] paid-crawl budget refund failed",
				expect.objectContaining({
					url: "https://example.com/doc.pdf",
					error: "Error: DynamoDB throttled",
				}),
			);
		});
	});
});
