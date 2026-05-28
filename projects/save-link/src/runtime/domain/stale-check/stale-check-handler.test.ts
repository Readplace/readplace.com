import type { LoadArticle, TransitionAndPersist } from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/hutch-logger";
import type {
	FindArticleCrawlStatus,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	FindArticleFreshness,
} from "@packages/test-fixtures/providers/article-store";
import type {
	PublishRefreshArticleContent,
	PublishSaveAnonymousLink,
	PublishUpdateFetchTimestamp,
} from "@packages/test-fixtures/providers/events";
import type { SQSEvent, SQSRecordAttributes, Context } from "aws-lambda";
import type {
	CrawlAndFinalizeArticle,
	CrawlAndFinalizeResult,
} from "../save-link/crawl-and-finalize-article";
import type { FinalizedArticle } from "../save-link/finalize-article";
import type { MarkCrawlStage } from "../../providers/article-crawl/mark-crawl-stage";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import { initStaleCheckHandler } from "./stale-check-handler";

const STALE_TTL_MS = 86_400_000;
const URL_UNDER_TEST = "https://example.com/article";

const noopLoadArticle: LoadArticle = async () => undefined;
const noopTransitionAndPersist: TransitionAndPersist = async () => {};
const fixedNow = () => new Date("2026-05-18T12:00:00.000Z");

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
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
			awsRegion: "ap-southeast-2",
		}],
	};
}

type HandlerDeps = Parameters<typeof initStaleCheckHandler>[0];

const failingCrawlAndFinalize: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });

const noopFindArticleFreshness: FindArticleFreshness = async () => null;
const noopFindArticleCrawlStatus: FindArticleCrawlStatus = async () => undefined;

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initStaleCheckHandler({
		findArticleFreshness: noopFindArticleFreshness,
		findArticleCrawlStatus: noopFindArticleCrawlStatus,
		crawlAndFinalizeArticle: failingCrawlAndFinalize,
		publishRefreshArticleContent: jest.fn().mockResolvedValue(undefined),
		publishUpdateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		publishSaveAnonymousLink: jest.fn().mockResolvedValue(undefined),
		emitSimpleCrawlUnsupported: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		loadArticle: noopLoadArticle,
		transitionAndPersist: noopTransitionAndPersist,
		now: fixedNow,
		staleTtlMs: STALE_TTL_MS,
		logger: noopLogger,
		...overrides,
	});
}

describe("initStaleCheckHandler", () => {
	it("publishes SaveAnonymousLinkCommand when the row is missing (e.g. evicted between view and worker)", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => null;
		const publishSaveAnonymousLink: PublishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ findArticleFreshness, publishSaveAnonymousLink });

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(1);
		expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: URL_UNDER_TEST });
	});

	it("does nothing when the crawl status is terminal-skip (failed)", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: undefined,
			lastModified: undefined,
			contentFetchedAt: "2026-04-01T00:00:00.000Z",
		});
		const findArticleCrawlStatus: FindArticleCrawlStatus = async () => ({
			status: "failed",
			reason: "parse-error",
		});
		const crawlAndFinalizeArticle = jest.fn(failingCrawlAndFinalize);
		const publishSaveAnonymousLink: PublishSaveAnonymousLink = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			findArticleCrawlStatus,
			crawlAndFinalizeArticle,
			publishSaveAnonymousLink,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(crawlAndFinalizeArticle).not.toHaveBeenCalled();
		expect(publishSaveAnonymousLink).not.toHaveBeenCalled();
	});

	it("does nothing when the row is within the TTL window (no crawl fired)", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: undefined,
			lastModified: undefined,
			contentFetchedAt: "2026-05-18T11:30:00.000Z",
		});
		const crawlAndFinalizeArticle = jest.fn(failingCrawlAndFinalize);

		const handler = createHandler({
			findArticleFreshness,
			crawlAndFinalizeArticle,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(crawlAndFinalizeArticle).not.toHaveBeenCalled();
	});

	it("publishes UpdateFetchTimestamp on 304 Not Modified", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: '"abc"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
			contentFetchedAt: "2026-04-01T00:00:00.000Z",
		});
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "not-modified" });
		const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			crawlAndFinalizeArticle,
			publishUpdateFetchTimestamp,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishUpdateFetchTimestamp).toHaveBeenCalledTimes(1);
		expect(publishUpdateFetchTimestamp).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			contentFetchedAt: fixedNow().toISOString(),
		});
	});

	it("forwards the stored etag/lastModified into crawlAndFinalize so the crawler can short-circuit on 304", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: '"abc"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
			contentFetchedAt: "2026-04-01T00:00:00.000Z",
		});
		const crawlAndFinalizeArticle = jest.fn<
			Promise<CrawlAndFinalizeResult>,
			Parameters<CrawlAndFinalizeArticle>
		>().mockResolvedValue({ status: "not-modified" });

		const handler = createHandler({
			findArticleFreshness,
			crawlAndFinalizeArticle,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(crawlAndFinalizeArticle).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			etag: '"abc"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
		});
	});

	it("emits SimpleCrawlUnsupportedEvent with refresh=true and marks comprehensive-fetching stage when crawl returns unsupported (e.g. PDF body)", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: undefined,
			lastModified: undefined,
			contentFetchedAt: "2026-04-01T00:00:00.000Z",
		});
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "unsupported",
			reason: "non-html content type: application/pdf",
		});
		const emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = jest
			.fn()
			.mockResolvedValue(undefined);
		const markCrawlStage: MarkCrawlStage = jest.fn().mockResolvedValue(undefined);
		const publishRefreshArticleContent: PublishRefreshArticleContent = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			crawlAndFinalizeArticle,
			emitSimpleCrawlUnsupported,
			markCrawlStage,
			publishRefreshArticleContent,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(markCrawlStage).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			stage: "comprehensive-fetching",
		});
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			refresh: true,
		});
		expect(publishRefreshArticleContent).not.toHaveBeenCalled();
	});

	it("skips when crawl returns failed (no further effect)", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: undefined,
			lastModified: undefined,
			contentFetchedAt: "2026-04-01T00:00:00.000Z",
		});
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });
		const publishRefreshArticleContent: PublishRefreshArticleContent = jest
			.fn()
			.mockResolvedValue(undefined);
		const publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp = jest
			.fn()
			.mockResolvedValue(undefined);
		const emitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			crawlAndFinalizeArticle,
			publishRefreshArticleContent,
			publishUpdateFetchTimestamp,
			emitSimpleCrawlUnsupported,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishRefreshArticleContent).not.toHaveBeenCalled();
		expect(publishUpdateFetchTimestamp).not.toHaveBeenCalled();
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
	});

	it("publishes RefreshArticleContent with the finalizer's metadata + freshness when the crawl returns fetched", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: '"prev"',
			lastModified: "Wed, 01 Apr 2026 00:00:00 GMT",
			contentFetchedAt: "2026-04-01T00:00:00.000Z",
		});
		const finalizedArticle: FinalizedArticle = {
			html: "<p>hi</p>",
			metadata: {
				title: "Hi",
				siteName: "example.com",
				excerpt: "Hi excerpt",
				wordCount: 200,
				estimatedReadTime: 1,
				imageUrl: "https://cdn.example.com/content/x/images/abc.png",
			},
		};
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "fetched",
			article: finalizedArticle,
			etag: '"new"',
			lastModified: "Sat, 17 May 2026 00:00:00 GMT",
		});
		const publishRefreshArticleContent: PublishRefreshArticleContent = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			crawlAndFinalizeArticle,
			publishRefreshArticleContent,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(publishRefreshArticleContent).toHaveBeenCalledWith({
			url: URL_UNDER_TEST,
			html: "<p>hi</p>",
			metadata: {
				title: "Hi",
				siteName: "example.com",
				excerpt: "Hi excerpt",
				wordCount: 200,
				imageUrl: "https://cdn.example.com/content/x/images/abc.png",
			},
			estimatedReadTime: 1,
			etag: '"new"',
			lastModified: "Sat, 17 May 2026 00:00:00 GMT",
			contentFetchedAt: fixedNow().toISOString(),
		});
	});

	it("processes every record in a batch", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => null;
		const publishSaveAnonymousLink: PublishSaveAnonymousLink = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = createHandler({ findArticleFreshness, publishSaveAnonymousLink });

		const batch: SQSEvent = {
			Records: [
				{
					messageId: "msg-1",
					receiptHandle: "receipt-1",
					body: JSON.stringify({ detail: { url: "https://a.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
				{
					messageId: "msg-2",
					receiptHandle: "receipt-2",
					body: JSON.stringify({ detail: { url: "https://b.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
			],
		};

		const result = await handler(batch, stubContext, () => {});

		expect(publishSaveAnonymousLink).toHaveBeenNthCalledWith(1, { url: "https://a.example.com/" });
		expect(publishSaveAnonymousLink).toHaveBeenNthCalledWith(2, { url: "https://b.example.com/" });
		expect(result).toEqual({ batchItemFailures: [] });
	});

	it("reports the failed record (and only that record) when checkAndRefresh throws mid-batch", async () => {
		const findArticleFreshness = jest
			.fn<ReturnType<FindArticleFreshness>, Parameters<FindArticleFreshness>>()
			.mockResolvedValueOnce(null)
			.mockRejectedValueOnce(new Error("DDB throttled"));
		const publishSaveAnonymousLink: PublishSaveAnonymousLink = jest
			.fn()
			.mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness: findArticleFreshness as unknown as FindArticleFreshness,
			publishSaveAnonymousLink,
		});

		const batch: SQSEvent = {
			Records: [
				{
					messageId: "msg-1",
					receiptHandle: "receipt-1",
					body: JSON.stringify({ detail: { url: "https://a.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
				{
					messageId: "msg-2",
					receiptHandle: "receipt-2",
					body: JSON.stringify({ detail: { url: "https://b.example.com/" } }),
					attributes: stubAttributes,
					messageAttributes: {},
					md5OfBody: "",
					eventSource: "aws:sqs",
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
					awsRegion: "ap-southeast-2",
				},
			],
		};

		const result = await handler(batch, stubContext, () => {});

		expect(publishSaveAnonymousLink).toHaveBeenCalledTimes(1);
		expect(publishSaveAnonymousLink).toHaveBeenCalledWith({ url: "https://a.example.com/" });
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-2" }] });
	});

	it("reports the record as a batch failure when the event detail fails zod validation", async () => {
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
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:StaleCheckRequested",
				awsRegion: "ap-southeast-2",
			}],
		};

		const result = await handler(invalidEvent, stubContext, () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("reprimes a failed summary via incrementSummaryAutoHealAttempt when decideSummaryAutoHeal says 'reprime'", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: undefined,
			lastModified: undefined,
			contentFetchedAt: "2026-05-18T11:30:00.000Z",
		});
		const loadArticle: LoadArticle = async () => ({
			url: URL_UNDER_TEST,
			metadata: { title: "t", siteName: "s", excerpt: "e", wordCount: 1 },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			estimatedReadTime: 1,
			crawl: { kind: "ready" },
			summary: { kind: "failed", reason: { kind: "model-overload" } },
			summaryAutoHeal: { attempts: 0 },
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			loadArticle,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(transitionAndPersist).toHaveBeenCalledTimes(1);
		expect(transitionAndPersist).toHaveBeenCalledWith(
			expect.any(Function),
			expect.objectContaining({
				url: URL_UNDER_TEST,
				input: { now: fixedNow().toISOString() },
			}),
		);
	});

	it("does not call transitionAndPersist when the article is summary=ready (decideSummaryAutoHeal returns 'skip')", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => ({
			etag: undefined,
			lastModified: undefined,
			contentFetchedAt: "2026-05-18T11:30:00.000Z",
		});
		const loadArticle: LoadArticle = async () => ({
			url: URL_UNDER_TEST,
			metadata: { title: "t", siteName: "s", excerpt: "e", wordCount: 1 },
			freshness: { contentFetchedAt: "2026-01-01T00:00:00.000Z" },
			estimatedReadTime: 1,
			crawl: { kind: "ready" },
			summary: { kind: "ready", summary: "abc" },
			summaryAutoHeal: { attempts: 0 },
		});
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			loadArticle,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("does not call transitionAndPersist when loadArticle returns undefined (row not yet persisted)", async () => {
		const findArticleFreshness: FindArticleFreshness = async () => null;
		const loadArticle: LoadArticle = async () => undefined;
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({
			findArticleFreshness,
			loadArticle,
			transitionAndPersist,
		});

		await handler(createSqsEvent({ url: URL_UNDER_TEST }), stubContext, () => {});

		expect(transitionAndPersist).not.toHaveBeenCalled();
	});
});
