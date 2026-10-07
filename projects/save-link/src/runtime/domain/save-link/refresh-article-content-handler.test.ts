import { createHash } from "node:crypto";
import { noopLogger } from "@packages/hutch-logger";
import { RefreshContentExtractedEvent } from "@packages/hutch-infra-components";
import type { ReadRefreshHtml } from "@packages/test-fixtures/providers/refresh-html";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import { initRefreshArticleContentHandler } from "./refresh-article-content-handler";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

interface RefreshDetail {
	url: string;
	sourceUrl?: string;
	sourceOriginalUrl?: string;
	metadata: {
		title: string;
		siteName: string;
		excerpt: string;
		wordCount: number;
		imageUrl?: string;
	};
	estimatedReadTime: number;
	etag?: string;
	lastModified?: string;
	contentFetchedAt: string;
	bodyHash?: string;
}

function createSqsEvent(detail: RefreshDetail): SQSEvent {
	return {
		Records: [
			{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ detail: { saveAttemptId: "attempt-1", sourceUrl: URL, sourceOriginalUrl: URL, ...detail } }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
				awsRegion: "ap-southeast-2",
			},
		],
	};
}

const URL = "https://example.com/article";
const HTML = "<html><body><h1>Refreshed</h1></body></html>";
const DETAIL: RefreshDetail = {
	url: URL,
	metadata: {
		title: "New title",
		siteName: "Example",
		excerpt: "New excerpt",
		wordCount: 250,
	},
	estimatedReadTime: 2,
	etag: '"new-etag"',
	lastModified: "Sun, 10 May 2026 12:00:00 GMT",
	contentFetchedAt: "2026-05-10T12:00:00.000Z",
	bodyHash: "a".repeat(64),
};

describe("initRefreshArticleContentHandler (S3 read + tier-write + publish)", () => {
	it("reads the staged HTML from S3 and writes it as a tier-1 source so the selector can compare it against an existing tier-0", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(readRefreshHtml).toHaveBeenCalledWith(URL, { saveAttemptId: "attempt-1" });
		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
			url: URL,
			tier: "tier-1",
			html: HTML,
			metadata: expect.objectContaining({
				title: "New title",
				siteName: "Example",
				excerpt: "New excerpt",
				wordCount: 250,
				estimatedReadTime: 2,
			}),
		}));
	});

	it("publishes RefreshContentExtractedEvent carrying url + freshness so the downstream selector handler can persist", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(RefreshContentExtractedEvent, expect.objectContaining({
			url: URL,
			etag: '"new-etag"',
			lastModified: "Sun, 10 May 2026 12:00:00 GMT",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
			bodyHash: "a".repeat(64),
		}));
	});

	it("forwards bodyHash from the command into RefreshContentExtractedEvent so the persister can land it on the freshness row", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ ...DETAIL, bodyHash: "deadbeef".repeat(8) }), buildLambdaContext(), () => {});

		expect(publishEvent).toHaveBeenCalledWith(RefreshContentExtractedEvent, expect.objectContaining({
			url: URL,
			etag: '"new-etag"',
			lastModified: "Sun, 10 May 2026 12:00:00 GMT",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
			bodyHash: "deadbeef".repeat(8),
		}));
	});

	it("reads S3, writes the tier source, then publishes — in that order, so a fast downstream handler doesn't race a missing tier-1 read", async () => {
		const order: string[] = [];
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockImplementation(async () => {
			order.push("readRefreshHtml");
			return HTML;
		});
		const putTierSource: PutTierSource = jest.fn().mockImplementation(async () => {
			order.push("putTierSource");
		});
		const publishEvent = jest.fn().mockImplementation(async () => {
			order.push("publishEvent");
		});

		const handler = initRefreshArticleContentHandler({
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(order).toEqual(["readRefreshHtml", "readRefreshHtml", "putTierSource", "publishEvent"]);
	});

	it("reports the record as a batch failure on invalid event detail (zod failure) without touching S3 or tier source or event bus", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn();
		const putTierSource: PutTierSource = jest.fn();
		const publishEvent = jest.fn();

		const handler = initRefreshArticleContentHandler({
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
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
					eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RefreshArticleContent",
					awsRegion: "ap-southeast-2",
				},
			],
		};

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(readRefreshHtml).not.toHaveBeenCalled();
		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("reports a batch failure and does not publish when readRefreshHtml throws (stale message with no staged S3 object)", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest
			.fn()
			.mockRejectedValue(new Error("S3 NoSuchKey"));
		const putTierSource: PutTierSource = jest.fn();
		const publishEvent = jest.fn();

		const handler = initRefreshArticleContentHandler({
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(putTierSource).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("does not publish when putTierSource throws so the downstream handler doesn't run with no tier-1 to read", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest
			.fn()
			.mockRejectedValue(new Error("s3 throttled"));
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(publishEvent).not.toHaveBeenCalled();
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
	it("binds candidate provenance to the staged attempt and the actual evaluation bytes", async () => {
		const putTierSource: PutTierSource = jest.fn();
		const publishEvent = jest.fn();
		const handler = initRefreshArticleContentHandler({ resolveOriginalUrl: async () => URL, readRefreshHtml: async () => HTML, putTierSource, publishEvent, logger: noopLogger });
		await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});
		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ html: HTML, metadata: expect.objectContaining({ attemptId: "attempt-1", originalUrl: URL, sourceUrl: URL, kind: "live", contentHash: createHash("sha256").update(HTML).digest("hex") }) }));
		expect(publishEvent).toHaveBeenCalledWith(RefreshContentExtractedEvent, expect.objectContaining({ saveAttemptId: "attempt-1", candidates: [{ id: expect.any(String), tier: "tier-1" }] }));
	});

});


it("preserves actual response identity and raw evaluation separately from finalized reader HTML", async () => {
	const raw = "<html><body>Raw origin response with chrome</body></html>";
	const sourceUrl = "https://example.com/article?edition=current";
	const putTierSource = jest.fn();
	const handler = initRefreshArticleContentHandler({ resolveOriginalUrl: async () => URL, readRefreshHtml: async (_url, options) => options?.representation === "evaluation" ? raw : HTML, putTierSource, publishEvent: jest.fn(), logger: noopLogger });
	await expect(handler(createSqsEvent({ ...DETAIL, sourceUrl }), buildLambdaContext(), () => {})).resolves.toEqual({ batchItemFailures: [] });
	expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ html: HTML, evaluationHtml: raw, metadata: expect.objectContaining({ kind: "live", sourceUrl, originalUrl: URL, contentHash: createHash("sha256").update(raw).digest("hex") }) }));
});

it("rejects stale refresh original proof before reading or writing artifacts", async () => {
	const readRefreshHtml = jest.fn();
	const putTierSource = jest.fn();
	const handler = initRefreshArticleContentHandler({ resolveOriginalUrl: async () => URL, readRefreshHtml, putTierSource, publishEvent: jest.fn(), logger: noopLogger });
	await expect(handler(createSqsEvent({ ...DETAIL, sourceOriginalUrl: "https://different.example/article" }), buildLambdaContext(), () => {})).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	expect(readRefreshHtml).not.toHaveBeenCalled();
	expect(putTierSource).not.toHaveBeenCalled();
});
