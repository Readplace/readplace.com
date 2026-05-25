import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/hutch-logger";
import { markCrawlFailed, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import { initSaveLinkRawPdfCommandHandler } from "./save-link-raw-pdf-command-handler";
import { initProcessContentWithLocalMedia } from "../save-link/process-content-with-local-media";
import type { ParseHtml } from "@packages/article-parser";
import type { ExtractPdf } from "@packages/crawl-article";
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
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveLinkRawPdfCommand",
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

const PDF_MAGIC_BYTES = Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(16)]);

const successfulParse: ParseHtml = () => ({
	ok: true,
	article: {
		title: "Test PDF",
		siteName: "example.com",
		excerpt: "test",
		wordCount: 10,
		content: "<p>PDF content</p>",
	},
});

const successfulExtractPdf: ExtractPdf = async ({ url: _url }) => ({
	kind: "fetched",
	html: "<html><body><p>PDF content</p></body></html>",
	title: "Test PDF",
});

type HandlerDeps = Parameters<typeof initSaveLinkRawPdfCommandHandler>[0];

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const deps: HandlerDeps = {
		readPendingPdf: jest.fn().mockResolvedValue(PDF_MAGIC_BYTES),
		extractPdf: successfulExtractPdf,
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
	return { handler: initSaveLinkRawPdfCommandHandler(deps), deps };
}

describe("initSaveLinkRawPdfCommandHandler", () => {
	it("reads pending PDF bytes, extracts to HTML, writes a tier-0 source, and emits TierContentExtractedEvent carrying userId", async () => {
		const { handler, deps } = createHandler();

		await handler(
			createSqsEvent({ url: "https://example.com/x.pdf", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(deps.readPendingPdf).toHaveBeenCalledWith("https://example.com/x.pdf");
		expect(deps.putTierSource).toHaveBeenCalledWith({
			url: "https://example.com/x.pdf",
			tier: "tier-0",
			html: "<p>PDF content</p>",
			metadata: {
				title: "Test PDF",
				siteName: "example.com",
				excerpt: "test",
				wordCount: 10,
				estimatedReadTime: 1,
				imageUrl: undefined,
			},
		});
		expect(deps.publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "TierContentExtracted",
			detail: JSON.stringify({
				url: "https://example.com/x.pdf",
				tier: "tier-0",
				userId: "user-1",
			}),
		});
	});

	it("writes the tier-0 source before publishing TierContentExtractedEvent", async () => {
		const calls: string[] = [];
		const publishEvent = jest.fn(async () => { calls.push("publishEvent"); });
		const putTierSource: PutTierSource = jest.fn(async () => { calls.push("putTierSource"); });

		const { handler } = createHandler({ publishEvent, putTierSource });

		await handler(
			createSqsEvent({ url: "https://example.com/x.pdf", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(calls).toEqual(["putTierSource", "publishEvent"]);
	});

	it("flips crawl to unsupported (terminal) and skips tier-source write when extractPdf returns failed", async () => {
		const failingExtractPdf: ExtractPdf = async () => ({
			kind: "failed",
			reason: "ocr returned empty",
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const { handler } = createHandler({
			extractPdf: failingExtractPdf,
			transitionAndPersist,
			putTierSource,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad.pdf", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, {
			url: "https://example.com/bad.pdf",
			input: {
				reason: {
					kind: "non-html-content",
					contentType: "pdf extraction failed: ocr returned empty",
				},
			},
		});
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("routes terminal parse errors through markCrawlFailed and reports the record as a batch failure so SQS redelivers it", async () => {
		const failingParse: ParseHtml = () => ({
			ok: false,
			reason: "Readability returned null",
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const error = jest.fn();
		const logger = { ...noopLogger, error };

		const { handler } = createHandler({
			parseHtml: failingParse,
			transitionAndPersist,
			putTierSource,
			publishEvent,
			logger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad.pdf", userId: "user-1" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/bad.pdf",
			input: {
				reason: { kind: "parse-error", detail: "Readability returned null" },
			},
		});
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith(
			"[SaveLinkRawPdfCommand] record failed",
			expect.objectContaining({
				messageId: "msg-1",
				error: expect.objectContaining({
					message:
						"[SaveLinkRawPdfCommand] parse failed for https://example.com/bad.pdf: Readability returned null",
				}),
			}),
		);
	});
});
