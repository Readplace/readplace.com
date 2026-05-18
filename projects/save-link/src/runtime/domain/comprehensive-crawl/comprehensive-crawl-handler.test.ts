import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/hutch-logger";
import type { ComprehensiveCrawl } from "@packages/crawl-article";
import { markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import { initComprehensiveCrawlHandler } from "./comprehensive-crawl-handler";
import { initProcessContentWithLocalMedia } from "../save-link/process-content-with-local-media";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia } from "../save-link/download-media";
import type { PutImageObject } from "../../providers/article-store/s3-put-image-object";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
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

function createSqsEvent(detail: { url: string; userId?: string; recrawl?: boolean }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:ComprehensiveCrawlCommand",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const noopDownloadMedia: DownloadMedia = async () => [];

const processContent = initProcessContentWithLocalMedia({
	rewriteHtmlUrls: (html, rewriteUrl) => {
		const plugin = urls({ eachURL: rewriteUrl });
		return posthtml().use(plugin).process(html).then(result => result.html);
	},
});

const successfulComprehensiveCrawl: ComprehensiveCrawl = async () => ({
	status: "fetched",
	html: "<html><body><p>Extracted PDF content</p></body></html>",
});

const successfulParse: ParseHtml = () => ({
	ok: true,
	article: { title: "Test", siteName: "example.com", excerpt: "test", wordCount: 10, content: "<p>Extracted PDF content</p>" },
});

const imagesCdnBaseUrl = "https://cdn.example.com";

type HandlerDeps = Parameters<typeof initComprehensiveCrawlHandler>[0];

const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initComprehensiveCrawlHandler({
		comprehensiveCrawl: successfulComprehensiveCrawl,
		parseHtml: successfulParse,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		putImageObject: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		downloadMedia: noopDownloadMedia,
		processContent,
		imagesCdnBaseUrl,
		now: fixedNow,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		...overrides,
	});
}

describe("initComprehensiveCrawlHandler", () => {
	it("writes a tier-1 source with the extracted PDF content and emits TierContentExtractedEvent carrying userId", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ putTierSource, publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }), stubContext, () => {});

		expect(putTierSource).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			tier: "tier-1",
			html: "<p>Extracted PDF content</p>",
			metadata: expect.objectContaining({
				title: "Test",
				siteName: "example.com",
				excerpt: "test",
				wordCount: 10,
			}),
		});

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "TierContentExtracted",
			detail: JSON.stringify({ url: "https://example.com/doc.pdf", tier: "tier-1", userId: "user-1" }),
		});
	});

	it("emits TierContentExtractedEvent without userId when none was provided (anonymous save path)", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), stubContext, () => {});

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "TierContentExtracted",
			detail: JSON.stringify({ url: "https://example.com/doc.pdf", tier: "tier-1" }),
		});
	});

	it("emits RecrawlContentExtractedEvent (and NOT TierContentExtractedEvent) when the command was dispatched with recrawl=true", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", recrawl: true }), stubContext, () => {});

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "RecrawlContentExtracted",
			detail: JSON.stringify({ url: "https://example.com/doc.pdf" }),
		});
	});

	it("flips the row to terminal unsupported when comprehensiveCrawl reports unsupported (e.g. scanned PDF after OCR fallback failed)", async () => {
		const unsupportedComprehensiveCrawl: ComprehensiveCrawl = async () => ({
			status: "unsupported",
			reason: "pdf extraction failed: text-layer empty and OCR returned no text",
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			comprehensiveCrawl: unsupportedComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
			putTierSource,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/scan.pdf", userId: "user-1" }),
			stubContext,
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
		const unsupportedComprehensiveCrawl: ComprehensiveCrawl = async () => ({
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
			comprehensiveCrawl: unsupportedComprehensiveCrawl,
			logCrawlOutcome,
			readTierSnapshot,
		});

		await handler(createSqsEvent({ url: "https://example.com/scan.pdf" }), stubContext, () => {});

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/scan.pdf",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});
	});

	it("throws (record routed to batchItemFailures) when comprehensiveCrawl returns 'failed' so SQS retries", async () => {
		const failingComprehensiveCrawl: ComprehensiveCrawl = async () => ({ status: "failed" });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			comprehensiveCrawl: failingComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("routes terminal parse errors through markCrawlFailed via transitionAndPersist (same behavior as save-link-work)", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const failedParse: ParseHtml = () => ({ ok: false, reason: "Readability crashed on this DOM" });

		const handler = createHandler({ parseHtml: failedParse, transitionAndPersist });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad.pdf" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/bad.pdf",
			input: { reason: { kind: "parse-error", detail: "Readability crashed on this DOM" } },
		});
	});

	it("latches comprehensive-extracting on the first onPdfPage callback so the bar advances inside the extractor but later pages do not re-write the stage", async () => {
		const comprehensiveCrawl: ComprehensiveCrawl = async ({ onPdfPage }) => {
			if (onPdfPage) {
				onPdfPage({ pageIndex: 1, pageCount: 3 });
				onPdfPage({ pageIndex: 2, pageCount: 3 });
				onPdfPage({ pageIndex: 3, pageCount: 3 });
			}
			return { status: "fetched", html: "<html><body><p>x</p></body></html>" };
		};
		const markCrawlStage = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			comprehensiveCrawl,
			markCrawlStage,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), stubContext, () => {});
		// Fire-and-forget catch handler queues a microtask. Drain it before
		// counting stage writes so the assertion sees the stable state.
		await new Promise((resolve) => setImmediate(resolve));

		const extractingWrites = markCrawlStage.mock.calls.filter(
			(call) => call[0].stage === "comprehensive-extracting",
		);
		expect(extractingWrites).toHaveLength(1);
	});

	it("logs a warning and continues when the comprehensive-extracting stage write fails (best-effort beacon)", async () => {
		const comprehensiveCrawl: ComprehensiveCrawl = async ({ onPdfPage }) => {
			if (onPdfPage) onPdfPage({ pageIndex: 1, pageCount: 1 });
			await new Promise((resolve) => setImmediate(resolve));
			return { status: "fetched", html: "<html><body><p>x</p></body></html>" };
		};
		const markCrawlStage = jest.fn(async ({ stage }: { stage: string }) => {
			if (stage === "comprehensive-extracting") throw new Error("DynamoDB throttled");
		});
		const warn = jest.fn();
		const logger = { ...noopLogger, warn };

		const handler = createHandler({
			comprehensiveCrawl,
			markCrawlStage,
			logger,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), stubContext, () => {});

		expect(warn).toHaveBeenCalledWith(
			"[ComprehensiveCrawlCommand] comprehensive-extracting stage write failed",
			expect.objectContaining({
				url: "https://example.com/doc.pdf",
				error: "Error: DynamoDB throttled",
			}),
		);
	});

	it("uploads the crawled thumbnail to S3 and threads the resolved CDN URL into the tier-source metadata", async () => {
		const imageBody = Buffer.from([0xff, 0xd8, 0xff]);
		const comprehensiveCrawl: ComprehensiveCrawl = async () => ({
			status: "fetched",
			html: "<html></html>",
			thumbnailImage: {
				body: imageBody,
				contentType: "image/jpeg",
				url: "https://cdn.example.com/thumb.jpg",
				extension: ".jpg",
			},
		});
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ comprehensiveCrawl, putImageObject, putTierSource });

		await handler(createSqsEvent({ url: "https://example.com/article" }), stubContext, () => {});

		expect(putImageObject).toHaveBeenCalledWith(expect.objectContaining({
			contentType: "image/jpeg",
		}));
		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					imageUrl: expect.stringContaining("https://cdn.example.com/"),
				}),
			}),
		);
	});

	it("records contentFetchedAt + etag + lastModified after a successful PDF extraction so future saves can short-circuit on TTL", async () => {
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const comprehensiveCrawl: ComprehensiveCrawl = async () => ({
			status: "fetched",
			html: "<html><body><p>x</p></body></html>",
			etag: '"pdf-abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
		});

		const handler = createHandler({ comprehensiveCrawl, updateFetchTimestamp });

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf" }), stubContext, () => {});

		expect(updateFetchTimestamp).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			contentFetchedAt: "2026-04-18T12:00:00.000Z",
			etag: '"pdf-abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
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

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
