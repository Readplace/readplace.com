import {
	type Article,
	markSummaryReady,
	markSummarySkipped,
} from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/hutch-logger";
import type { Context, SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { initGenerateSummaryHandler } from "./generate-summary-handler";
import type { SummarizeArticle } from "./link-summariser";
import type { FindArticleContent } from "../../providers/article-store/find-article-content";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";

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

function pendingArticle(url: string): Article {
	return {
		url,
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
		estimatedReadTime: 1,
		crawl: { kind: "ready" },
		summary: { kind: "pending", pendingSince: "2026-01-01T00:00:00.000Z" },
		summaryAutoHeal: { attempts: 0 },
	};
}

type HandlerDeps = Parameters<typeof initGenerateSummaryHandler>[0];

const NOW = new Date("2026-05-30T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	const deps: HandlerDeps = {
		summarizeArticle: jest.fn<ReturnType<SummarizeArticle>, Parameters<SummarizeArticle>>(),
		findArticleContent: jest.fn<ReturnType<FindArticleContent>, Parameters<FindArticleContent>>().mockResolvedValue({ content: "<p>content</p>" }),
		loadArticle: jest.fn().mockResolvedValue(pendingArticle("https://example.com/x")),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		now: () => NOW,
		logger: noopLogger,
		...overrides,
	};
	return { handler: initGenerateSummaryHandler(deps), deps };
}

describe("initGenerateSummaryHandler", () => {
	it("fires markSummaryReady with summary/excerpt/inputTokens/outputTokens + sourceContentHash on the happy path", async () => {
		const URL = "https://example.com/article";
		const html = "<p>article content</p>";
		const { handler, deps } = createHandler({
			summarizeArticle: jest.fn<ReturnType<SummarizeArticle>, Parameters<SummarizeArticle>>().mockResolvedValue({
				kind: "ready",
				summary: "A summary.",
				excerpt: "A blurb.",
				inputTokens: 100,
				outputTokens: 50,
			}),
			findArticleContent: jest.fn<ReturnType<FindArticleContent>, Parameters<FindArticleContent>>().mockResolvedValue({ content: html }),
			loadArticle: jest.fn().mockResolvedValue(pendingArticle(URL)),
		});

		const result = await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markSummaryReady, {
			url: URL,
			input: {
				summary: "A summary.",
				excerpt: "A blurb.",
				inputTokens: 100,
				outputTokens: 50,
				sourceContentHash: computeCanonicalContentHash(html),
				now: NOW.toISOString(),
			},
		});
	});

	it("short-circuits without calling the summariser when the cached row is summary=ready", async () => {
		const URL = "https://example.com/cached-ready";
		const cached: Article = {
			...pendingArticle(URL),
			summary: { kind: "ready", summary: "cached", excerpt: "cached blurb" },
		};
		const { handler, deps } = createHandler({
			loadArticle: jest.fn().mockResolvedValue(cached),
		});

		const result = await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.summarizeArticle).not.toHaveBeenCalled();
		expect(deps.findArticleContent).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
	});

	it("short-circuits without calling the summariser when the cached row is summary=skipped", async () => {
		const URL = "https://example.com/cached-skipped";
		const cached: Article = {
			...pendingArticle(URL),
			summary: { kind: "skipped", reason: "content-too-short" },
		};
		const { handler, deps } = createHandler({
			loadArticle: jest.fn().mockResolvedValue(cached),
		});

		await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(deps.summarizeArticle).not.toHaveBeenCalled();
		expect(deps.findArticleContent).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
	});

	it("does not short-circuit when the cached row is summary=failed (redrive scenario)", async () => {
		const URL = "https://example.com/cached-failed";
		const cached: Article = {
			...pendingArticle(URL),
			summary: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 4 } },
		};
		const { handler, deps } = createHandler({
			summarizeArticle: jest.fn<ReturnType<SummarizeArticle>, Parameters<SummarizeArticle>>().mockResolvedValue({
				kind: "ready",
				summary: "Recovered.",
				excerpt: "Recovered blurb.",
				inputTokens: 100,
				outputTokens: 50,
			}),
			loadArticle: jest.fn().mockResolvedValue(cached),
		});

		await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markSummaryReady, expect.objectContaining({ url: URL }));
	});

	it("fires markSummarySkipped with reason='content-too-short' when the summariser skips", async () => {
		const URL = "https://example.com/short";
		const { handler, deps } = createHandler({
			summarizeArticle: jest.fn<ReturnType<SummarizeArticle>, Parameters<SummarizeArticle>>().mockResolvedValue({
				kind: "skipped",
				reason: "content-too-short",
			}),
			loadArticle: jest.fn().mockResolvedValue(pendingArticle(URL)),
		});

		const result = await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markSummarySkipped, {
			url: URL,
			input: { reason: "content-too-short", now: NOW.toISOString() },
		});
	});

	it("fires markSummarySkipped with reason='ai-unavailable' when the summariser reports AI unavailable", async () => {
		const URL = "https://example.com/unavailable";
		const { handler, deps } = createHandler({
			summarizeArticle: jest.fn<ReturnType<SummarizeArticle>, Parameters<SummarizeArticle>>().mockResolvedValue({
				kind: "skipped",
				reason: "ai-unavailable",
			}),
			loadArticle: jest.fn().mockResolvedValue(pendingArticle(URL)),
		});

		await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(deps.transitionAndPersist).toHaveBeenCalledWith(markSummarySkipped, {
			url: URL,
			input: { reason: "ai-unavailable", now: NOW.toISOString() },
		});
	});

	it("reports batchItemFailures when the summariser returns no-text-block so SQS redelivers and eventually DLQs", async () => {
		const URL = "https://example.com/no-text-block";
		const { handler, deps } = createHandler({
			summarizeArticle: jest.fn<ReturnType<SummarizeArticle>, Parameters<SummarizeArticle>>().mockResolvedValue({ kind: "no-text-block" }),
			loadArticle: jest.fn().mockResolvedValue(pendingArticle(URL)),
		});

		const result = await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
	});

	it("reports batchItemFailures when article content is not found (assert in handler)", async () => {
		const URL = "https://example.com/missing";
		const error = jest.fn();
		const { handler, deps } = createHandler({
			findArticleContent: jest.fn<ReturnType<FindArticleContent>, Parameters<FindArticleContent>>().mockResolvedValue(undefined),
			loadArticle: jest.fn().mockResolvedValue(pendingArticle(URL)),
			logger: { ...noopLogger, error },
		});

		const result = await handler(createSqsEvent({ url: URL }), stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deps.summarizeArticle).not.toHaveBeenCalled();
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
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

	it("reports batchItemFailures on invalid command schema (Zod failure)", async () => {
		const { handler, deps } = createHandler();

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
		expect(deps.transitionAndPersist).not.toHaveBeenCalled();
	});
});
