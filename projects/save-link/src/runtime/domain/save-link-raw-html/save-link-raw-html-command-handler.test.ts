import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/hutch-logger";
import { markCrawlFailed } from "@packages/domain/article-aggregate";
import { TierContentExtractedEvent } from "@packages/hutch-infra-components";
import { initSaveLinkRawHtmlCommandHandler } from "./save-link-raw-html-command-handler";
import { initProcessContentWithLocalMedia } from "../save-link/process-content-with-local-media";
import type { ParseHtml } from "@packages/article-parser";
import type { DownloadMedia } from "../save-link/download-media";
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

function createSqsEvent(detail: { url: string; userId: string; title?: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveLinkRawHtmlCommand",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const noopDownloadMedia: DownloadMedia = async () => [];

const processContent = initProcessContentWithLocalMedia({
	rewriteHtmlUrls: (html, rewriteUrl) => {
		const plugin = urls({ eachURL: rewriteUrl });
		return posthtml().use(plugin).process(html).then((result) => result.html);
	},
});

const successfulParse: ParseHtml = () => ({
	ok: true,
	article: {
		title: "Test",
		siteName: "example.com",
		excerpt: "test",
		wordCount: 10,
		content: "<p>Article content</p>",
	},
});

type HandlerDeps = Parameters<typeof initSaveLinkRawHtmlCommandHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const deps: HandlerDeps = {
		readPendingHtml: jest.fn().mockResolvedValue("<html><body><p>Article content</p></body></html>"),
		parseHtml: successfulParse,
		downloadMedia: noopDownloadMedia,
		processContent,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		}),
		...overrides,
	};
	return { handler: initSaveLinkRawHtmlCommandHandler(deps), deps };
}

describe("initSaveLinkRawHtmlCommandHandler", () => {
	it("reads pending HTML, writes a tier-0 source with metadata, and emits TierContentExtractedEvent carrying userId", async () => {
		const { handler, deps } = createHandler();

		await handler(
			createSqsEvent({ url: "https://example.com/article", userId: "user-1", title: "Captured Title" }),
			stubContext,
			() => {},
		);

		expect(deps.readPendingHtml).toHaveBeenCalledWith("https://example.com/article");
		expect(deps.putTierSource).toHaveBeenCalledWith({
			url: "https://example.com/article",
			tier: "tier-0",
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
		expect(deps.publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
			url: "https://example.com/article",
			tier: "tier-0",
			userId: "user-1",
		});
	});

	it("writes the tier-0 source before publishing TierContentExtractedEvent (selector relies on the source being listable)", async () => {
		const calls: string[] = [];
		const publishEvent = jest.fn(async () => { calls.push("publishEvent"); });
		const putTierSource: PutTierSource = jest.fn(async () => { calls.push("putTierSource"); });

		const { handler } = createHandler({ publishEvent, putTierSource });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(calls).toEqual(["putTierSource", "publishEvent"]);
	});

	it("routes terminal parse errors through markCrawlFailed via transitionAndPersist and reports the record as a batch failure so SQS redelivers it", async () => {
		const failedParse: ParseHtml = () => ({ ok: false, reason: "Readability returned null" });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const error = jest.fn();
		const logger = { ...noopLogger, error };

		const { handler } = createHandler({
			parseHtml: failedParse,
			transitionAndPersist,
			putTierSource,
			publishEvent,
			logger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/bad",
			input: {
				reason: { kind: "parse-error", detail: "Readability returned null" },
			},
		});
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
		// Confirms the throw inside the worker propagated to the per-record catch
		// with the expected diagnostic, even though it no longer escapes the handler.
		expect(error).toHaveBeenCalledWith(
			"[SaveLinkRawHtmlCommand] record failed",
			expect.objectContaining({
				messageId: "msg-1",
				error: expect.objectContaining({
					message: "save-link-raw-html parse failed for https://example.com/bad: Readability returned null",
				}),
			}),
		);
	});

	it("threads downloaded media into processContent so HTML references the CDN URLs", async () => {
		const parseWithImage: ParseHtml = () => ({
			ok: true,
			article: {
				title: "T",
				siteName: "s",
				excerpt: "e",
				wordCount: 1,
				content: '<img src="https://example.com/img.png">',
			},
		});
		const downloadMedia: DownloadMedia = jest.fn().mockResolvedValue([
			{ originalUrl: "https://example.com/img.png", cdnUrl: "https://cdn/images/abc.png" },
		]);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({ parseHtml: parseWithImage, downloadMedia, putTierSource });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({
				html: expect.stringContaining("https://cdn/images/abc.png"),
			}),
		);
	});

	it("emits logParseError before reporting the record as a batch failure, so the failure reaches the parse-errors dashboard", async () => {
		const failedParse: ParseHtml = () => ({ ok: false, reason: "no-readable-content" });
		const { handler, deps } = createHandler({ parseHtml: failedParse });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.logParseError).toHaveBeenCalledWith({
			url: "https://example.com/bad",
			reason: "no-readable-content",
		});
	});

	it("emits a tier-0 failure crawl-outcome before reporting the batch failure, reflecting tier-1's snapshot at emission time", async () => {
		const failedParse: ParseHtml = () => ({ ok: false, reason: "no-readable-content" });
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "not_attempted",
			tier1Status: "success",
			pickedTier: "tier-1",
		});
		const { handler, deps } = createHandler({ parseHtml: failedParse, readTierSnapshot });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/bad",
			thisTier: "tier-0",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-1",
		});
	});

	it("emits a tier-0 failure crawl-outcome with otherTierStatus=failed when tier-1 has already failed, distinguishing it from a never-attempted tier-1", async () => {
		const failedParse: ParseHtml = () => ({ ok: false, reason: "no-readable-content" });
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "not_attempted",
			tier1Status: "failed",
			pickedTier: "none",
		});
		const { handler, deps } = createHandler({ parseHtml: failedParse, readTierSnapshot });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/bad",
			thisTier: "tier-0",
			thisTierStatus: "failed",
			otherTierStatus: "failed",
			pickedTier: "none",
		});
	});

	it("emits a tier-0 success crawl-outcome after a successful save, snapshotting whether tier-1 also succeeded", async () => {
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});
		const { handler, deps } = createHandler({ readTierSnapshot });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(deps.logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/article",
			thisTier: "tier-0",
			thisTierStatus: "success",
			otherTierStatus: "not_attempted",
			pickedTier: "tier-0",
		});
	});

	it("emits otherTierStatus=success in the tier-0 success crawl-outcome when tier-1 has already completed", async () => {
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "success",
			pickedTier: "tier-1",
		});
		const { handler, deps } = createHandler({ readTierSnapshot });

		await handler(createSqsEvent({ url: "https://example.com/article", userId: "user-1" }), stubContext, () => {});

		expect(deps.logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/article",
			thisTier: "tier-0",
			thisTierStatus: "success",
			otherTierStatus: "success",
			pickedTier: "tier-1",
		});
	});

	it("logs the extension-captured title alongside the tier-0 save for debuggability", async () => {
		const info = jest.fn();
		const logger = { ...noopLogger, info };
		const { handler } = createHandler({ logger });

		await handler(
			createSqsEvent({ url: "https://example.com/article", userId: "user-1", title: "Captured Title" }),
			stubContext,
			() => {},
		);

		expect(info).toHaveBeenCalledWith(
			"[SaveLinkRawHtmlCommand] tier-0 source written",
			expect.objectContaining({ url: "https://example.com/article", capturedTitle: "Captured Title" }),
		);
	});

	it("extracts og:image from the captured rawHtml and threads it as thumbnailUrl into parseHtml so the tier-0 metadata carries imageUrl", async () => {
		const rawHtml = `<html><head>
			<meta property="og:image" content="https://example.com/og.png">
		</head><body><article><p>Body</p></article></body></html>`;
		const parseHtml = jest.fn(((_params) => ({
			ok: true as const,
			article: {
				title: "T",
				siteName: "example.com",
				excerpt: "e",
				wordCount: 1,
				content: "<p>x</p>",
				imageUrl: "https://example.com/og.png",
			},
		})) satisfies ParseHtml);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const { handler } = createHandler({
			readPendingHtml: jest.fn().mockResolvedValue(rawHtml),
			parseHtml,
			putTierSource,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/article", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(parseHtml).toHaveBeenCalledWith({
			url: "https://example.com/article",
			html: rawHtml,
			thumbnailUrl: "https://example.com/og.png",
		});
		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ imageUrl: "https://example.com/og.png" }),
			}),
		);
	});

	it("passes thumbnailUrl=null when the captured rawHtml exposes no image candidates", async () => {
		const rawHtml = `<html><head><title>No images</title></head><body><article><p>Body</p></article></body></html>`;
		const parseHtml = jest.fn(((_params) => ({
			ok: true as const,
			article: {
				title: "T",
				siteName: "example.com",
				excerpt: "e",
				wordCount: 1,
				content: "<p>x</p>",
			},
		})) satisfies ParseHtml);
		const { handler } = createHandler({
			readPendingHtml: jest.fn().mockResolvedValue(rawHtml),
			parseHtml,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/article", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(parseHtml).toHaveBeenCalledWith({
			url: "https://example.com/article",
			html: rawHtml,
			thumbnailUrl: null,
		});
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const { handler } = createHandler();

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { wrong: "shape" } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveLinkRawHtmlCommand",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

});
