import { noopLogger } from "@packages/hutch-logger";
import { initRefreshArticleContentHandler } from "./refresh-article-content-handler";
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

function createSqsEvent(detail: {
	url: string;
	metadata: { title: string; siteName: string; excerpt: string; wordCount: number; imageUrl?: string };
	estimatedReadTime: number;
	etag?: string;
	lastModified?: string;
	contentFetchedAt: string;
}): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
			awsRegion: "ap-southeast-2",
		}],
	};
}

describe("initRefreshArticleContentHandler", () => {
	it("calls refreshArticleContent with parsed detail and dispatches GenerateSummaryCommand", async () => {
		// Why this matters: refreshArticleContent invalidates the cached summary
		// (clears summary text + flips status back to pending). If the handler
		// did not also dispatch GenerateSummaryCommand the row would sit in the
		// pending state forever — no worker would ever pick it up — and the
		// reader would render "Generating summary…" indefinitely. This is
		// exactly the regression that left
		// fagnerbrack.com/why-developers-become-frustrated-… stuck after the
		// 2026-05-10 freshness refresh.
		const refreshArticleContent = jest.fn().mockResolvedValue(undefined);
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			refreshArticleContent,
			dispatchGenerateSummary,
			logger: noopLogger,
		});

		await handler(createSqsEvent({
			url: "https://example.com/article",
			metadata: { title: "Test", siteName: "example.com", excerpt: "Excerpt", wordCount: 100 },
			estimatedReadTime: 1,
			etag: '"abc"',
			lastModified: "Thu, 10 Apr 2026 12:00:00 GMT",
			contentFetchedAt: "2026-04-10T12:00:00Z",
		}), stubContext, () => {});

		expect(refreshArticleContent).toHaveBeenCalledTimes(1);
		expect(refreshArticleContent).toHaveBeenCalledWith({
			url: "https://example.com/article",
			metadata: { title: "Test", siteName: "example.com", excerpt: "Excerpt", wordCount: 100 },
			estimatedReadTime: 1,
			etag: '"abc"',
			lastModified: "Thu, 10 Apr 2026 12:00:00 GMT",
			contentFetchedAt: "2026-04-10T12:00:00Z",
		});
		expect(dispatchGenerateSummary).toHaveBeenCalledTimes(1);
		expect(dispatchGenerateSummary).toHaveBeenCalledWith({ url: "https://example.com/article" });
	});

	it("dispatches AFTER refreshArticleContent so the worker never reads a status=ready cache hit", async () => {
		// Why this matters: summarizeArticle short-circuits when the cached
		// summaryStatus is "ready" or "skipped" (link-summariser.ts:52). If we
		// dispatched the command before refreshArticleContent flipped the row
		// out of "ready", a fast-running worker could read the stale cache,
		// log "already summarized", and return — leaving the row with the
		// new content but no regenerated summary. Locking the order eliminates
		// that race.
		const order: string[] = [];
		const refreshArticleContent = jest.fn().mockImplementation(async () => {
			order.push("refresh");
		});
		const dispatchGenerateSummary = jest.fn().mockImplementation(async () => {
			order.push("dispatch");
		});

		const handler = initRefreshArticleContentHandler({
			refreshArticleContent,
			dispatchGenerateSummary,
			logger: noopLogger,
		});

		await handler(createSqsEvent({
			url: "https://example.com/article",
			metadata: { title: "Test", siteName: "example.com", excerpt: "Excerpt", wordCount: 100 },
			estimatedReadTime: 1,
			contentFetchedAt: "2026-04-10T12:00:00Z",
		}), stubContext, () => {});

		expect(order).toEqual(["refresh", "dispatch"]);
	});

	it("reports the record as a batch failure on invalid event detail (Zod failure)", async () => {
		const handler = initRefreshArticleContentHandler({
			refreshArticleContent: jest.fn(),
			dispatchGenerateSummary: jest.fn(),
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("does not dispatch when refreshArticleContent throws", async () => {
		// Why this matters: dispatching a regen command for an URL whose row
		// the DDB update could not write would summarise stale content (or
		// stamp a row that does not exist) — the handler must let the SQS
		// retry replay the whole transaction.
		const refreshArticleContent = jest.fn().mockRejectedValue(new Error("DDB throttled"));
		const dispatchGenerateSummary = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			refreshArticleContent,
			dispatchGenerateSummary,
			logger: noopLogger,
		});

		const result = await handler(createSqsEvent({
			url: "https://example.com/article",
			metadata: { title: "Test", siteName: "example.com", excerpt: "Excerpt", wordCount: 100 },
			estimatedReadTime: 1,
			contentFetchedAt: "2026-04-10T12:00:00Z",
		}), stubContext, () => {});

		expect(dispatchGenerateSummary).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
