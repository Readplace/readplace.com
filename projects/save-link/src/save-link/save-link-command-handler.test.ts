import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/hutch-logger";
import type { CrawlArticle } from "@packages/crawl-article";
import { initSaveLinkCommandHandler } from "./save-link-command-handler";
import { initProcessContentWithLocalMedia } from "./process-content-with-local-media";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia } from "./download-media";
import type { PutImageObject } from "./s3-put-image-object";
import type { PutTierSource } from "../select-content/put-tier-source";
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

const successfulCrawl: CrawlArticle = async () => ({
	status: "fetched",
	html: "<html><body><p>Article content</p></body></html>",
});

const successfulParse: ParseHtml = () => ({
	ok: true,
	article: { title: "Test", siteName: "example.com", excerpt: "test", wordCount: 10, content: "<p>Article content</p>" },
});

const imagesCdnBaseUrl = "https://cdn.example.com";

type HandlerDeps = Parameters<typeof initSaveLinkCommandHandler>[0];

const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initSaveLinkCommandHandler({
		crawlArticle: successfulCrawl,
		parseHtml: successfulParse,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		putImageObject: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		markCrawlFailed: jest.fn().mockResolvedValue(undefined),
		markCrawlUnsupported: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		markSummarySkipped: jest.fn().mockResolvedValue(undefined),
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
		const crawlArticle: CrawlArticle = async () => ({
			status: "fetched",
			html: "<html><body><p>Article content</p></body></html>",
			etag: '"abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
		});

		const handler = createHandler({ crawlArticle, updateFetchTimestamp });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(updateFetchTimestamp).toHaveBeenCalledWith({
			url: "https://example.com/article",
			contentFetchedAt: "2026-04-18T12:00:00.000Z",
			etag: '"abc123"',
			lastModified: "Wed, 15 Apr 2026 10:00:00 GMT",
		});
	});

	it("does not write a tier source or publish anything when the crawl fails (record reported as batch failure for SQS redelivery)", async () => {
		const failedCrawl: CrawlArticle = async () => ({ status: "failed" });
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ crawlArticle: failedCrawl, putTierSource, publishEvent });

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
		const failedCrawl: CrawlArticle = async () => ({ status: "failed" });

		const handler = createHandler({ crawlArticle: failedCrawl, logParseError });

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
		const failedCrawl: CrawlArticle = async () => ({ status: "failed" });

		const handler = createHandler({ crawlArticle: failedCrawl, logCrawlOutcome, readTierSnapshot });

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

	it("opts into thumbnail fetching when calling crawlArticle", async () => {
		const crawlArticle = jest.fn<ReturnType<CrawlArticle>, Parameters<CrawlArticle>>().mockResolvedValue({
			status: "fetched",
			html: "<html><body><p>Article content</p></body></html>",
		});

		const handler = createHandler({ crawlArticle });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(crawlArticle).toHaveBeenCalledWith({
			url: "https://example.com/article",
			fetchThumbnail: true,
		});
	});

	it("marks crawl 'failed' inline on terminal parse errors so readers see failure at t+0 instead of waiting ~90s for the DLQ", async () => {
		const markCrawlFailed = jest.fn().mockResolvedValue(undefined);
		const failedParse: ParseHtml = () => ({ ok: false, reason: "Readability crashed on this DOM" });
		const error = jest.fn();
		const logger = { ...noopLogger, error };

		const handler = createHandler({ parseHtml: failedParse, markCrawlFailed, logger });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(markCrawlFailed).toHaveBeenCalledWith({
			url: "https://example.com/bad",
			reason: "Readability crashed on this DOM",
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

	it("does NOT mark crawl 'failed' on a transient fetch failure (those stay on the SQS retry / DLQ path)", async () => {
		const markCrawlFailed = jest.fn().mockResolvedValue(undefined);
		const failedCrawl: CrawlArticle = async () => ({ status: "failed" });

		const handler = createHandler({ crawlArticle: failedCrawl, markCrawlFailed });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(markCrawlFailed).not.toHaveBeenCalled();
	});

	it("flips a non-html origin (e.g. PDF) directly to crawlStatus='unsupported' + summaryStatus='skipped', does NOT throw, and does NOT emit TierContentExtracted", async () => {
		const markCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const markCrawlFailed = jest.fn().mockResolvedValue(undefined);
		const markSummarySkipped = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const unsupportedCrawl: CrawlArticle = async () => ({
			status: "unsupported",
			reason: "non-html content type: application/pdf",
		});

		const handler = createHandler({
			crawlArticle: unsupportedCrawl,
			markCrawlUnsupported,
			markCrawlFailed,
			markSummarySkipped,
			publishEvent,
			putTierSource,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf", userId: "user-1" }),
			stubContext,
			() => {},
		);

		// Successful terminal outcome — no batch failure, no SQS retry.
		expect(result).toEqual({ batchItemFailures: [] });
		expect(markCrawlUnsupported).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			reason: "non-html content type: application/pdf",
		});
		expect(markSummarySkipped).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			reason: "crawl-unsupported",
		});
		expect(markCrawlFailed).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("uploads the crawled thumbnail to S3 and threads the resolved CDN URL into the tier-source metadata", async () => {
		const imageBody = Buffer.from([0xff, 0xd8, 0xff]);
		const crawlArticle: CrawlArticle = async () => ({
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

		const handler = createHandler({ crawlArticle, putImageObject, putTierSource });

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
