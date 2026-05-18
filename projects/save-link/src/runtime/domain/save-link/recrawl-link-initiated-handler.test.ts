import posthtml from "posthtml";
import urls from "@11ty/posthtml-urls";
import { noopLogger } from "@packages/hutch-logger";
import type { SimpleCrawl } from "@packages/crawl-article";
import { initRecrawlLinkInitiatedHandler } from "./recrawl-link-initiated-handler";
import { initProcessContentWithLocalMedia } from "./process-content-with-local-media";
import type { ParseHtml } from "../article-parser/article-parser.types";
import type { DownloadMedia } from "./download-media";
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
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RecrawlLinkInitiated",
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

type HandlerDeps = Parameters<typeof initRecrawlLinkInitiatedHandler>[0];

const fixedNow = () => new Date("2026-04-30T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initRecrawlLinkInitiatedHandler({
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

describe("initRecrawlLinkInitiatedHandler", () => {
	it("crawls the URL and emits RecrawlContentExtractedEvent on success", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/article" }), stubContext, () => {});

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "RecrawlContentExtracted",
			detail: JSON.stringify({ url: "https://example.com/article" }),
		});
	});

	it("reports the record as a batch failure when saveLinkWork throws on a failed crawl (so SQS redelivers just that record)", async () => {
		const failingSimpleCrawl: SimpleCrawl = async () => ({ status: "failed" });
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			simpleCrawl: failingSimpleCrawl,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("emits SimpleCrawlUnsupportedEvent with recrawl=true when simpleCrawl returns unsupported and does NOT publish RecrawlContentExtractedEvent itself (the policy → comprehensive chain will)", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<
			ReturnType<EmitSimpleCrawlUnsupported>,
			Parameters<EmitSimpleCrawlUnsupported>
		>().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const unsupportedSimpleCrawl: SimpleCrawl = async () => ({
			status: "unsupported",
			reason: "non-html content type: application/pdf",
		});

		const handler = createHandler({
			simpleCrawl: unsupportedSimpleCrawl,
			emitSimpleCrawlUnsupported,
			transitionAndPersist,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledTimes(1);
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			userId: undefined,
			recrawl: true,
		});
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure when the event detail is invalid (Zod failure)", async () => {
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RecrawlLinkInitiated",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
