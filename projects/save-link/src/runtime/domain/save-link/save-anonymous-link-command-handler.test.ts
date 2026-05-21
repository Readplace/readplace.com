import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/hutch-logger";
import type { SimpleCrawl } from "@packages/crawl-article";
import { markCrawlFailed } from "@packages/domain/article-aggregate";
import { initSaveAnonymousLinkCommandHandler } from "./save-anonymous-link-command-handler";
import { initProcessContentWithLocalMedia } from "./process-content-with-local-media";
import type { ParseHtml } from "@packages/article-parser";
import type { DownloadMedia } from "./download-media";
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

function createSqsEvent(detail: { url: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveAnonymousLinkCommand",
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

const rejectingEmitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = async () => {
	throw new Error("emitSimpleCrawlUnsupported invoked unexpectedly");
};

const successfulParse: ParseHtml = () => ({
	ok: true,
	article: { title: "Test", siteName: "example.com", excerpt: "test", wordCount: 10, content: "<p>Article content</p>" },
});

const imagesCdnBaseUrl = "https://cdn.example.com";

type HandlerDeps = Parameters<typeof initSaveAnonymousLinkCommandHandler>[0];

const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initSaveAnonymousLinkCommandHandler({
		simpleCrawl: successfulSimpleCrawl,
		emitSimpleCrawlUnsupported: rejectingEmitSimpleCrawlUnsupported,
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

describe("initSaveAnonymousLinkCommandHandler", () => {
	it("writes a tier-1 source and emits TierContentExtractedEvent without userId", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ putTierSource, publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/article" }), stubContext, () => {});

		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({ url: "https://example.com/article", tier: "tier-1" }),
		);
		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "TierContentExtracted",
			detail: JSON.stringify({ url: "https://example.com/article", tier: "tier-1" }),
		});
	});

	it("does not write a tier source or publish anything when the crawl fails (record reported as batch failure)", async () => {
		const failedSimpleCrawl: SimpleCrawl = async () => ({ status: "failed" });
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ simpleCrawl: failedSimpleCrawl, putTierSource, publishEvent });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable" }),
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
			createSqsEvent({ url: "https://example.com/unreachable" }),
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
			createSqsEvent({ url: "https://example.com/bad" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/bad",
			reason: "Invalid URL",
		});
	});

	it("routes terminal parse errors through markCrawlFailed via transitionAndPersist so /view + /admin/recrawl polling see failure at t+0", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const failedParse: ParseHtml = () => ({ ok: false, reason: "Readability crashed on this DOM" });

		const handler = createHandler({ parseHtml: failedParse, transitionAndPersist });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/bad" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/bad",
			input: { reason: { kind: "parse-error", detail: "Readability crashed on this DOM" } },
		});
	});

	it("emits SimpleCrawlUnsupportedEvent without userId when simpleCrawl returns unsupported (anonymous path)", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<
			ReturnType<EmitSimpleCrawlUnsupported>,
			Parameters<EmitSimpleCrawlUnsupported>
		>().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const unsupportedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: "non-html content type: application/pdf",
		});

		const handler = createHandler({
			simpleCrawl: unsupportedSimpleCrawl,
			emitSimpleCrawlUnsupported,
			transitionAndPersist,
			publishEvent,
			putTierSource,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/blob" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledTimes(1);
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: "https://example.com/blob",
			userId: undefined,
			recrawl: undefined,
		});
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SaveAnonymousLinkCommand",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
