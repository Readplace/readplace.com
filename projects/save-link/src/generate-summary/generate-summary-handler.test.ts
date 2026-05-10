import { noopLogger } from "@packages/hutch-logger";
import { initGenerateSummaryHandler } from "./generate-summary-handler";
import type { SummarizeArticle } from "./article-summary.types";
import type { FindArticleContent } from "../save-link/find-article-content";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
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
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:GenerateGlobalSummary",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initGenerateSummaryHandler", () => {
	it("should summarize article and publish GlobalSummaryGenerated event", async () => {
		const summarizeArticle: SummarizeArticle = async () => ({
			summary: "A summary.",
			excerpt: "A blurb.",
			inputTokens: 100,
			outputTokens: 20,
		});
		const findArticleContent: FindArticleContent = async () => ({ content: "<p>Article content</p>" });
		const publishEvent: PublishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: "https://example.com/article" }), stubContext, () => {});

		expect(publishEvent).toHaveBeenCalledWith({
			source: "hutch.save-link",
			detailType: "GlobalSummaryGenerated",
			detail: JSON.stringify({
				url: "https://example.com/article",
				inputTokens: 100,
				outputTokens: 20,
			}),
		});
	});

	it("reports the record as a batch failure when article content not found (SQS will retry, DLQ consumer handles terminal failure)", async () => {
		const summarizeArticle: SummarizeArticle = async () => null;
		const findArticleContent: FindArticleContent = async () => undefined;
		const publishEvent: PublishEvent = jest.fn();
		const error = jest.fn();
		const logger = { ...noopLogger, error };

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			publishEvent,
			logger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/missing" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(publishEvent).not.toHaveBeenCalled();
		// Confirms the assert(article) propagated to the per-record catch.
		expect(error).toHaveBeenCalledWith(
			"[GenerateGlobalSummary] record failed",
			expect.objectContaining({
				messageId: "msg-1",
				error: expect.objectContaining({
					message: expect.stringContaining("Article content not found"),
				}),
			}),
		);
	});

	it("should skip publishing when summarization returns null (cache hit or skipped)", async () => {
		const summarizeArticle: SummarizeArticle = async () => null;
		const findArticleContent: FindArticleContent = async () => ({ content: "<p>Content</p>" });
		const publishEvent: PublishEvent = jest.fn();

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ url: "https://example.com/cached" }), stubContext, () => {});

		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure on invalid command schema (Zod failure)", async () => {
		const summarizeArticle: SummarizeArticle = async () => null;
		const findArticleContent: FindArticleContent = async () => ({ content: "content" });
		const publishEvent: PublishEvent = jest.fn();

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			publishEvent,
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = {
			Records: [{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { invalid: true } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:GenerateGlobalSummary",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
