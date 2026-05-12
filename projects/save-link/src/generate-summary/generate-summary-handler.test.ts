import { noopLogger } from "@packages/hutch-logger";
import type {
	Article,
	LoadArticle,
	TransitionAndPersist,
} from "@packages/domain/article-aggregate";
import { initGenerateSummaryHandler } from "./generate-summary-handler";
import type { SummarizeArticle } from "./link-summariser";
import type { FindArticleContent } from "../save-link/find-article-content";
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
		Records: [
			{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN:
					"arn:aws:sqs:ap-southeast-2:123456789:GenerateGlobalSummary",
				awsRegion: "ap-southeast-2",
			},
		],
	};
}

function pendingArticle(url: string): Article {
	return {
		url,
		metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 100 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "pending" },
	};
}

describe("initGenerateSummaryHandler", () => {
	it("dispatches markSummaryReady when the summariser returns ready", async () => {
		const summarizeArticle: SummarizeArticle = async () => ({
			kind: "ready",
			summary: "A summary.",
			excerpt: "A blurb.",
			inputTokens: 100,
			outputTokens: 20,
		});
		const findArticleContent: FindArticleContent = async () => ({
			content: "<p>Article content</p>",
		});
		const loadArticle: LoadArticle = async (url) => pendingArticle(url);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			loadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/article" }),
			stubContext,
			() => {},
		);

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		const [transition, params] = transitionAndPersist.mock.calls[0] ?? [];
		expect((transition as { name: string }).name).toBe("markSummaryReady");
		expect(params).toEqual({
			url: "https://example.com/article",
			input: {
				summary: "A summary.",
				excerpt: "A blurb.",
				inputTokens: 100,
				outputTokens: 20,
			},
		});
	});

	it("dispatches markSummarySkipped when the summariser returns skipped", async () => {
		const summarizeArticle: SummarizeArticle = async () => ({
			kind: "skipped",
			reason: "content-too-short",
		});
		const findArticleContent: FindArticleContent = async () => ({
			content: "<p>tiny</p>",
		});
		const loadArticle: LoadArticle = async (url) => pendingArticle(url);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			loadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/short" }),
			stubContext,
			() => {},
		);

		const [transition, params] = transitionAndPersist.mock.calls[0] ?? [];
		expect((transition as { name: string }).name).toBe("markSummarySkipped");
		expect(params).toEqual({
			url: "https://example.com/short",
			input: { reason: "content-too-short" },
		});
	});

	it("short-circuits when the loaded aggregate already has summary.kind=ready", async () => {
		const summarizeArticle = jest.fn();
		const findArticleContent = jest.fn();
		const transitionAndPersist = jest.fn();
		const loadArticle: LoadArticle = async (url) => ({
			...pendingArticle(url),
			summary: {
				kind: "ready",
				summary: "cached",
				excerpt: "cached excerpt",
			},
		});

		const handler = initGenerateSummaryHandler({
			summarizeArticle: summarizeArticle as unknown as SummarizeArticle,
			findArticleContent: findArticleContent as unknown as FindArticleContent,
			loadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/cached" }),
			stubContext,
			() => {},
		);

		expect(summarizeArticle).not.toHaveBeenCalled();
		expect(findArticleContent).not.toHaveBeenCalled();
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("short-circuits when the loaded aggregate already has summary.kind=skipped", async () => {
		const summarizeArticle = jest.fn();
		const transitionAndPersist = jest.fn();
		const loadArticle: LoadArticle = async (url) => ({
			...pendingArticle(url),
			summary: { kind: "skipped", reason: "ai-unavailable" },
		});
		const findArticleContent = jest.fn();

		const handler = initGenerateSummaryHandler({
			summarizeArticle: summarizeArticle as unknown as SummarizeArticle,
			findArticleContent: findArticleContent as unknown as FindArticleContent,
			loadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/skipped" }),
			stubContext,
			() => {},
		);

		expect(summarizeArticle).not.toHaveBeenCalled();
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("re-runs the AI when the loaded aggregate has summary.kind=failed (redrive)", async () => {
		const summarizeArticle: SummarizeArticle = async () => ({
			kind: "ready",
			summary: "Recovered.",
			excerpt: "Recovered blurb.",
			inputTokens: 10,
			outputTokens: 5,
		});
		const findArticleContent: FindArticleContent = async () => ({
			content: "<p>content</p>",
		});
		const loadArticle: LoadArticle = async (url) => ({
			...pendingArticle(url),
			summary: { kind: "failed", reason: "timeout" },
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			loadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger: noopLogger,
		});

		await handler(
			createSqsEvent({ url: "https://example.com/retry" }),
			stubContext,
			() => {},
		);

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
	});

	it("reports the record as a batch failure when article content not found", async () => {
		const summarizeArticle = jest.fn();
		const findArticleContent: FindArticleContent = async () => undefined;
		const loadArticle: LoadArticle = async (url) => pendingArticle(url);
		const transitionAndPersist = jest.fn();
		const error = jest.fn();
		const logger = { ...noopLogger, error };

		const handler = initGenerateSummaryHandler({
			summarizeArticle: summarizeArticle as unknown as SummarizeArticle,
			findArticleContent,
			loadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/missing" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: "msg-1" }],
		});
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith(
			"[GenerateSummary] record failed",
			expect.objectContaining({
				messageId: "msg-1",
				error: expect.objectContaining({
					message: expect.stringContaining("Article content not found"),
				}),
			}),
		);
	});

	it("reports no-text-block as a batch failure so SQS retries", async () => {
		const summarizeArticle: SummarizeArticle = async () => ({
			kind: "no-text-block",
		});
		const findArticleContent: FindArticleContent = async () => ({
			content: "<p>content</p>",
		});
		const loadArticle: LoadArticle = async (url) => pendingArticle(url);
		const transitionAndPersist = jest.fn();

		const handler = initGenerateSummaryHandler({
			summarizeArticle,
			findArticleContent,
			loadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger: noopLogger,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/no-block" }),
			stubContext,
			() => {},
		);

		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: "msg-1" }],
		});
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("reports the record as a batch failure on invalid command schema (Zod failure)", async () => {
		const summarizeArticle = jest.fn();
		const findArticleContent = jest.fn();
		const loadArticle = jest.fn();
		const transitionAndPersist = jest.fn();

		const handler = initGenerateSummaryHandler({
			summarizeArticle: summarizeArticle as unknown as SummarizeArticle,
			findArticleContent: findArticleContent as unknown as FindArticleContent,
			loadArticle: loadArticle as unknown as LoadArticle,
			transitionAndPersist: transitionAndPersist as unknown as TransitionAndPersist,
			logger: noopLogger,
		});

		const invalidEvent: SQSEvent = {
			Records: [
				{
					messageId: "msg-1",
					receiptHandle: "receipt-1",
					body: JSON.stringify({ detail: { invalid: true } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN:
						"arn:aws:sqs:ap-southeast-2:123456789:GenerateGlobalSummary",
					awsRegion: "ap-southeast-2",
				},
			],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({
			batchItemFailures: [{ itemIdentifier: "msg-1" }],
		});
	});
});
