import { noopLogger } from "@packages/hutch-logger";
import { markCrawlFailed } from "@packages/domain/article-aggregate";
import { TierContentExtractedEvent } from "@packages/hutch-infra-components";
import { initSaveLinkCommandHandler } from "./save-link-command-handler";
import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "./crawl-and-finalize-article";
import type { FinalizedArticle } from "./finalize-article";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { SQSEvent, SQSRecordAttributes, Context } from "aws-lambda";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

const stubContext: Context = {
	callbackWaitsForEmptyEventLoop: true,
	functionName: "test",
	functionVersion: "1",
	invokedFunctionArn: "arn:aws:lambda:ap-southeast-2:123456789:function:test",
	memoryLimitInMB: "128",
	awsRequestId: "test-request-id",
	logGroupName: "/aws/lambda/test",
	logStreamName: "test-stream",
	getRemainingTimeInMillis: () => 30000,
	done: () => {},
	fail: () => {},
	succeed: () => {},
};

function createSqsEvent(detail: { url: string; userId: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveLinkCommand",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const stubFinalizedArticle: FinalizedArticle = {
	html: "<p>Article content</p>",
	metadata: {
		title: "Test",
		siteName: "example.com",
		excerpt: "test",
		wordCount: 10,
		estimatedReadTime: 1,
		imageUrl: undefined,
	},
};

const fetchedResult: CrawlAndFinalizeResult = {
	status: "fetched",
	article: stubFinalizedArticle,
};

const rejectingEmitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = async () => {
	throw new Error("emitSimpleCrawlUnsupported invoked unexpectedly");
};

type HandlerDeps = Parameters<typeof initSaveLinkCommandHandler>[0];

const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initSaveLinkCommandHandler({
		crawlAndFinalizeArticle: (async () => fetchedResult) as CrawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported: rejectingEmitSimpleCrawlUnsupported,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		markCrawlPartial: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		now: fixedNow,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		...overrides,
	});
}

describe("initSaveLinkCommandHandler", () => {
	it("writes a tier-1 source with the finalizer's metadata and emits TierContentExtractedEvent carrying userId", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ putTierSource, publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(putTierSource).toHaveBeenCalledWith({
			url: "https://example.com/article",
			tier: "tier-1",
			html: stubFinalizedArticle.html,
			metadata: stubFinalizedArticle.metadata,
		});
		expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
			url: "https://example.com/article",
			tier: "tier-1",
			userId: "user-1",
		});
	});

	it("writes the tier-1 source before publishing TierContentExtractedEvent (selector relies on the source being listable)", async () => {
		const calls: string[] = [];
		const publishEvent = jest.fn(async () => { calls.push("publishEvent"); });
		const putTierSource: PutTierSource = jest.fn(async () => { calls.push("putTierSource"); });

		const handler = createHandler({ publishEvent, putTierSource });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(calls).toEqual(["putTierSource", "publishEvent"]);
	});

	it("records contentFetchedAt + etag + lastModified after a successful fetch so future saves can short-circuit on TTL", async () => {
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "fetched",
			article: stubFinalizedArticle,
			etag: '"v1"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
		});
		const handler = createHandler({ crawlAndFinalizeArticle, updateFetchTimestamp });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(updateFetchTimestamp).toHaveBeenCalledWith({
			url: "https://example.com/article",
			contentFetchedAt: fixedNow().toISOString(),
			etag: '"v1"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
		});
	});

	it("does not write a tier source or publish anything when the crawl fails (record reported as batch failure for SQS redelivery)", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });

		const handler = createHandler({ crawlAndFinalizeArticle, putTierSource, publishEvent });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/article", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("reports failures via logParseError so the parse-errors dashboard reflects them", async () => {
		const logParseError = jest.fn();
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "readability crashed" });

		const handler = createHandler({ crawlAndFinalizeArticle, logParseError });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/article",
			reason: "readability crashed",
		});
	});

	it("emits a tier-1 success crawl-outcome on successful save, snapshotting the other tier's state", async () => {
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "success",
			pickedTier: "tier-1",
		});

		const handler = createHandler({ logCrawlOutcome, readTierSnapshot });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/article",
			thisTier: "tier-1",
			thisTierStatus: "success",
			otherTierStatus: "success",
			pickedTier: "tier-1",
		});
	});

	it("emits a tier-1 failure crawl-outcome when the crawl fails, reflecting tier-0's snapshot at emission time", async () => {
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });

		const handler = createHandler({ crawlAndFinalizeArticle, logCrawlOutcome, readTierSnapshot });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/article",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});
	});

	it("routes terminal parse-error failures through markCrawlFailed via transitionAndPersist so readers see failure at t+0 instead of waiting ~90s for the DLQ", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "Readability returned null" });

		const handler = createHandler({ crawlAndFinalizeArticle, transitionAndPersist });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/article",
			input: { reason: { kind: "parse-error", detail: "Readability returned null" } },
		});
	});

	it("does NOT dispatch a terminal transition on a transient crawl-failed (those stay on the SQS retry / DLQ path)", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });

		const handler = createHandler({ crawlAndFinalizeArticle, transitionAndPersist });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("emits SimpleCrawlUnsupportedEvent carrying the userId when the crawl reports unsupported (the policy Lambda dispatches ComprehensiveCrawlCommand)", async () => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "unsupported", reason: "non-html content type: application/pdf" });

		const handler = createHandler({ crawlAndFinalizeArticle, emitSimpleCrawlUnsupported, publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: "https://example.com/article",
			userId: "user-1",
			recrawl: undefined,
		});
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("marks comprehensive-fetching between the simple bail-out and the event emission so the reader's progress bar advances during the policy + comprehensive Lambda's cold-start", async () => {
		const calls: string[] = [];
		const markCrawlStage = jest.fn(async ({ stage }: { stage: string }) => { calls.push(`stage:${stage}`); });
		const emitSimpleCrawlUnsupported = jest.fn(async () => { calls.push("emit"); });
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "unsupported", reason: "non-html" });

		const handler = createHandler({ crawlAndFinalizeArticle, markCrawlStage, emitSimpleCrawlUnsupported });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(calls).toEqual([
			"stage:crawl-fetching",
			"stage:comprehensive-fetching",
			"emit",
		]);
	});

	it("treats a not-modified result as an unreachable bug (save-link-work never passes conditional headers, so the crawler should never short-circuit here)", async () => {
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "not-modified" });
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ crawlAndFinalizeArticle, putTierSource });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/article", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(putTierSource).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure when publishEvent throws so SQS retries the whole record (the inner work is idempotent)", async () => {
		const publishEvent = jest.fn().mockRejectedValue(new Error("eventbridge down"));

		const handler = createHandler({ publishEvent });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/article", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure surfaces before the worker runs)", async () => {
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveLinkCommand",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("logs a warning when markCrawlPartial throws but never fails the crawl — partial writes are a streaming UX nicety", async () => {
		const markCrawlPartial = jest.fn().mockRejectedValue(new Error("DynamoDB throttled"));
		const warn = jest.fn();
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		// crawlAndFinalizeArticle is the only path that triggers an
		// onPartialHtml fire — invoke it twice (preview + final, mirroring
		// the production flow) so the partial-write path runs twice against
		// the failing markCrawlPartial mock.
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async ({ onPartialHtml }) => {
			if (onPartialHtml) {
				onPartialHtml({ html: "<h1>preview</h1>", readyPageCount: 1 });
				onPartialHtml({ html: "<p>final</p>", readyPageCount: 1 });
			}
			return fetchedResult;
		};

		const handler = createHandler({
			crawlAndFinalizeArticle,
			markCrawlPartial,
			publishEvent,
			logger: { ...noopLogger, warn },
		});

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		// Save still succeeded — the canonical event still fires.
		expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, expect.objectContaining({
			url: "https://example.com/article",
			tier: "tier-1",
		}));
		expect(warn).toHaveBeenCalledWith(
			"[SaveLinkCommand] partial-content write failed",
			expect.objectContaining({
				url: "https://example.com/article",
				error: "Error: DynamoDB throttled",
			}),
		);
		// crawlAndFinalize fires onPartialHtml twice (preview + final); both
		// hit the failing mock, so the warn fires twice too.
		expect(warn).toHaveBeenCalledTimes(2);
	});
});
