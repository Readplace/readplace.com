import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/hutch-logger";
import type { ComprehensiveCrawl, SimpleCrawl } from "@packages/crawl-article";
import { PDF_DETECTED_REASON } from "@packages/crawl-article";
import { markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import { initSaveLinkCommandHandler } from "./save-link-command-handler";
import { initProcessContentWithLocalMedia } from "./process-content-with-local-media";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia } from "./download-media";
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

const noopDownloadMedia: DownloadMedia = async () => [];

const processContent = initProcessContentWithLocalMedia({
	rewriteHtmlUrls: (html, rewriteUrl) => {
		const plugin = urls({ eachURL: rewriteUrl });
		return posthtml().use(plugin).process(html).then(result => result.html);
	},
});

const successfulSimpleCrawl: SimpleCrawl = async () => ({
	status: "fetched",
	html: "<html><body><p>Article content</p></body></html>",
});

const rejectingComprehensiveCrawl: ComprehensiveCrawl = async () => {
	throw new Error("comprehensiveCrawl invoked unexpectedly");
};

const successfulParse: ParseHtml = () => ({
	ok: true,
	article: { title: "Test", siteName: "example.com", excerpt: "test", wordCount: 10, content: "<p>Article content</p>" },
});

const imagesCdnBaseUrl = "https://cdn.example.com";

type HandlerDeps = Parameters<typeof initSaveLinkCommandHandler>[0];

const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initSaveLinkCommandHandler({
		simpleCrawl: successfulSimpleCrawl,
		comprehensiveCrawl: rejectingComprehensiveCrawl,
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

describe("initSaveLinkCommandHandler", () => {
	it("writes a tier-1 source with metadata and emits TierContentExtractedEvent carrying userId", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ putTierSource, publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(putTierSource).toHaveBeenCalledWith({
			url: "https://example.com/article",
			tier: "tier-1",
			html: "<p>Article content</p>",
			metadata: {
				title: "Test",
				siteName: "example.com",
				excerpt: "test",
				wordCount: 10,
				estimatedReadTime: 1,
				imageUrl: undefined,
			},
		});

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "TierContentExtracted",
			detail: JSON.stringify({ url: "https://example.com/article", tier: "tier-1", userId: "user-1" }),
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
		const simpleCrawl: SimpleCrawl = async () => ({
			status: "fetched",
			html: "<html><body><p>Article content</p></body></html>",
			etag: '"abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
		});

		const handler = createHandler({ simpleCrawl, updateFetchTimestamp });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(updateFetchTimestamp).toHaveBeenCalledWith({
			url: "https://example.com/article",
			contentFetchedAt: "2026-04-18T12:00:00.000Z",
			etag: '"abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
		});
	});

	it("does not write a tier source or publish anything when the crawl fails (record reported as batch failure for SQS redelivery)", async () => {
		const failedSimpleCrawl: SimpleCrawl = async () => ({ status: "failed" });
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ simpleCrawl: failedSimpleCrawl, putTierSource, publishEvent });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("reports crawl failures via logParseError with the crawl status as reason (record routed to batchItemFailures for SQS retry)", async () => {
		const logParseError = jest.fn();
		const failedSimpleCrawl: SimpleCrawl = async () => ({ status: "failed" });

		const handler = createHandler({ simpleCrawl: failedSimpleCrawl, logParseError });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/unreachable",
			reason: "crawl-failed",
		});
	});

	it("reports parse failures via logParseError with the parser's reason (record routed to batchItemFailures for SQS retry)", async () => {
		const logParseError = jest.fn();
		const failedParse: ParseHtml = () => ({ ok: false, reason: "Invalid URL" });

		const handler = createHandler({ parseHtml: failedParse, logParseError });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/bad",
			reason: "Invalid URL",
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
		const failedSimpleCrawl: SimpleCrawl = async () => ({ status: "failed" });

		const handler = createHandler({ simpleCrawl: failedSimpleCrawl, logCrawlOutcome, readTierSnapshot });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/unreachable",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});
	});

	it("emits a tier-1 failure crawl-outcome when the parse fails and marks the other tier as not-attempted when tier-0 never captured", async () => {
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "not_attempted",
			tier1Status: "failed",
			pickedTier: "none",
		});
		const failedParse: ParseHtml = () => ({ ok: false, reason: "Readability crashed" });

		const handler = createHandler({ parseHtml: failedParse, logCrawlOutcome, readTierSnapshot });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/bad",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
	});

	it("opts into thumbnail fetching when calling simpleCrawl", async () => {
		const simpleCrawl = jest.fn<ReturnType<SimpleCrawl>, Parameters<SimpleCrawl>>().mockResolvedValue({
			status: "fetched",
			html: "<html><body><p>Article content</p></body></html>",
		});

		const handler = createHandler({ simpleCrawl });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(simpleCrawl).toHaveBeenCalledWith({
			url: "https://example.com/article",
			fetchThumbnail: true,
		});
	});

	it("routes terminal parse errors through markCrawlFailed via transitionAndPersist so readers see failure at t+0 instead of waiting ~90s for the DLQ", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const failedParse: ParseHtml = () => ({ ok: false, reason: "Readability crashed on this DOM" });
		const error = jest.fn();
		const logger = { ...noopLogger, error };

		const handler = createHandler({ parseHtml: failedParse, transitionAndPersist, logger });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/bad",
			input: { reason: { kind: "parse-error", detail: "Readability crashed on this DOM" } },
		});
		// Confirms the throw inside the worker propagated to the per-record catch
		// with the expected diagnostic, even though it no longer escapes the handler.
		expect(error).toHaveBeenCalledWith(
			"[SaveLinkCommand] record failed",
			expect.objectContaining({
				messageId: "msg-1",
				error: expect.objectContaining({
					message: "crawl failed for https://example.com/bad: Readability crashed on this DOM",
				}),
			}),
		);
	});

	it("does NOT dispatch a terminal transition on a transient fetch failure (those stay on the SQS retry / DLQ path)", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const failedSimpleCrawl: SimpleCrawl = async () => ({ status: "failed" });

		const handler = createHandler({ simpleCrawl: failedSimpleCrawl, transitionAndPersist });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("flips a non-html origin to crawlStatus='unsupported' + summaryStatus='skipped' atomically when the simple crawl reports a non-pdf unsupported (no comprehensive fall-through)", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const comprehensiveCrawl = jest.fn<ReturnType<ComprehensiveCrawl>, Parameters<ComprehensiveCrawl>>();
		const unsupportedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: "non-html content type: application/octet-stream",
		});

		const handler = createHandler({
			simpleCrawl: unsupportedSimpleCrawl,
			comprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
			putTierSource,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/blob", userId: "user-1" }),
			stubContext,
			() => {},
		);

		// Successful terminal outcome — no batch failure, no SQS retry.
		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, {
			url: "https://example.com/blob",
			input: { reason: { kind: "non-html-content", contentType: "non-html content type: application/octet-stream" } },
		});
		expect(comprehensiveCrawl).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("falls through to comprehensiveCrawl when simpleCrawl returns unsupported/pdf-detected and writes a tier-1 source on successful PDF extraction", async () => {
		const pdfDetectedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: PDF_DETECTED_REASON,
		});
		const comprehensiveCrawl = jest.fn<ReturnType<ComprehensiveCrawl>, Parameters<ComprehensiveCrawl>>().mockResolvedValue({
			status: "fetched",
			html: "<html><body><p>Extracted PDF content</p></body></html>",
		});
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			simpleCrawl: pdfDetectedSimpleCrawl,
			comprehensiveCrawl,
			putTierSource,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(comprehensiveCrawl).toHaveBeenCalledTimes(1);
		expect(comprehensiveCrawl).toHaveBeenCalledWith(expect.objectContaining({
			url: "https://example.com/doc.pdf",
			fetchThumbnail: true,
		}));
		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
			url: "https://example.com/doc.pdf",
			tier: "tier-1",
		}));
		expect(publishEvent).toHaveBeenCalledTimes(1);
	});

	it("marks the comprehensive-fetching stage between simple and comprehensive crawls so the reader's progress bar advances during the PDF download window", async () => {
		const pdfDetectedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: PDF_DETECTED_REASON,
		});
		const comprehensiveCrawl: ComprehensiveCrawl = async () => ({
			status: "fetched",
			html: "<html><body><p>x</p></body></html>",
		});
		const markCrawlStage = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			simpleCrawl: pdfDetectedSimpleCrawl,
			comprehensiveCrawl,
			markCrawlStage,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }), stubContext, () => {});

		const stages = markCrawlStage.mock.calls.map((call) => call[0].stage);
		expect(stages).toContain("comprehensive-fetching");
		expect(stages.indexOf("comprehensive-fetching")).toBeGreaterThan(stages.indexOf("crawl-fetching"));
		expect(stages).not.toContain("crawl-fetched");
	});

	it("flips the row to terminal unsupported when comprehensiveCrawl also reports unsupported (e.g. scanned PDF after OCR fallback failed)", async () => {
		const pdfDetectedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: PDF_DETECTED_REASON,
		});
		const unsupportedComprehensiveCrawl: ComprehensiveCrawl = async () => ({
			status: "unsupported",
			reason: "pdf extraction failed: text-layer empty and OCR returned no text",
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			simpleCrawl: pdfDetectedSimpleCrawl,
			comprehensiveCrawl: unsupportedComprehensiveCrawl,
			transitionAndPersist,
			publishEvent,
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
	});

	it("throws (record routed to batchItemFailures) when comprehensiveCrawl returns 'failed' so SQS retries", async () => {
		const pdfDetectedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: PDF_DETECTED_REASON,
		});
		const failingComprehensiveCrawl: ComprehensiveCrawl = async () => ({ status: "failed" });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			simpleCrawl: pdfDetectedSimpleCrawl,
			comprehensiveCrawl: failingComprehensiveCrawl,
			transitionAndPersist,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("latches comprehensive-extracting on the first onPdfPage callback so the bar advances inside the extractor but later pages do not re-write the stage", async () => {
		const pdfDetectedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: PDF_DETECTED_REASON,
		});
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
			simpleCrawl: pdfDetectedSimpleCrawl,
			comprehensiveCrawl,
			markCrawlStage,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }), stubContext, () => {});
		// Fire-and-forget catch handler queues a microtask. Drain it before
		// counting stage writes so the assertion sees the stable state.
		await new Promise((resolve) => setImmediate(resolve));

		const extractingWrites = markCrawlStage.mock.calls.filter(
			(call) => call[0].stage === "comprehensive-extracting",
		);
		expect(extractingWrites).toHaveLength(1);
	});

	it("logs a warning and continues when the comprehensive-extracting stage write fails (best-effort beacon)", async () => {
		const pdfDetectedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: PDF_DETECTED_REASON,
		});
		// A short timer holds the run open past the callback so the catch
		// handler's microtask drains before we assert on the warning.
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
			simpleCrawl: pdfDetectedSimpleCrawl,
			comprehensiveCrawl,
			markCrawlStage,
			logger,
		});

		await handler(createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }), stubContext, () => {});

		expect(warn).toHaveBeenCalledWith(
			"[SaveLinkCommand] comprehensive-extracting stage write failed",
			expect.objectContaining({
				url: "https://example.com/doc.pdf",
				error: "Error: DynamoDB throttled",
			}),
		);
	});

	it("uploads the crawled thumbnail to S3 and threads the resolved CDN URL into the tier-source metadata", async () => {
		const imageBody = Buffer.from([0xff, 0xd8, 0xff]);
		const simpleCrawl: SimpleCrawl = async () => ({
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

		const handler = createHandler({ simpleCrawl, putImageObject, putTierSource });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(putImageObject).toHaveBeenCalledWith({
			key: expect.stringMatching(/^content\/example\.com%2Farticle\/images\/[0-9a-f]{16}\.jpg$/),
			body: imageBody,
			contentType: "image/jpeg",
		});
		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({
					imageUrl: expect.stringMatching(/^https:\/\/cdn\.example\.com\/content\/example\.com%252Farticle\/images\/[0-9a-f]{16}\.jpg$/),
				}),
			}),
		);
	});

	it("falls back to the parsed og:image URL when the crawler did not fetch a thumbnail", async () => {
		const parseHtml: ParseHtml = () => ({
			ok: true,
			article: {
				title: "T", siteName: "s", excerpt: "e", wordCount: 1,
				content: "<p>x</p>",
				imageUrl: "https://example.com/og.png",
			},
		});
		const putImageObject: PutImageObject = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ parseHtml, putImageObject, putTierSource });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(putImageObject).not.toHaveBeenCalled();
		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ imageUrl: "https://example.com/og.png" }),
			}),
		);
	});

	it("threads downloaded media through processContent so HTML references the CDN URLs", async () => {
		const parseWithImage: ParseHtml = () => ({
			ok: true,
			article: { title: "T", siteName: "s", excerpt: "e", wordCount: 1, content: '<img src="https://example.com/img.png">' },
		});
		const downloadMedia: DownloadMedia = jest.fn().mockResolvedValue([
			{ originalUrl: "https://example.com/img.png", cdnUrl: "https://cdn/images/abc.png" },
		]);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ parseHtml: parseWithImage, downloadMedia, putTierSource });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({
				html: expect.stringContaining("https://cdn/images/abc.png"),
			}),
		);
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure surfaces before the worker runs)", async () => {
		const handler = createHandler();

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
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
});
