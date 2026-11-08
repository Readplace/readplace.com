import assert from "node:assert/strict";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { candidateProvenance } from "@packages/tier-source";
import { createHash } from "node:crypto";
import { noopLogger } from "@packages/logger";
import { RefreshArticleContentSkippedEvent, RefreshContentExtractedEvent } from "@packages/infra-components";
import type { ReadRefreshHtml } from "@packages/test-fixtures/providers/refresh-html";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { PutTierSource } from "@packages/tier-source";
import { initRefreshArticleContentHandler } from "./refresh-article-content-handler";
import type { FindRefreshAdmissionRow } from "./decide-refresh-skip";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";

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
		publishedOn?: string;
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

const admitRow: FindRefreshAdmissionRow = async () => ({ crawlStatus: "ready", contentFetchedAt: "2026-05-09T12:00:00.000Z" });

describe("initRefreshArticleContentHandler (S3 read + tier-write + publish)", () => {
	it("reads the staged HTML from S3 and writes it as a tier-1 source so the selector can compare it against an existing tier-0", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const { publishEvent } = initRecordingPublishEvent();

		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: admitRow,
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

	it("carries the command's publish date into the tier-1 manifest", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: admitRow,
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml: jest.fn().mockResolvedValue(HTML),
			putTierSource,
			publishEvent: initRecordingPublishEvent().publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ ...DETAIL, metadata: { ...DETAIL.metadata, publishedOn: "2025-10-08" } }), buildLambdaContext(), () => {});

		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({
			metadata: expect.objectContaining({ publishedOn: "2025-10-08" }),
		}));
	});

	it("publishes RefreshContentExtractedEvent carrying url + freshness so the downstream selector handler can persist", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const { publishEvent, published } = initRecordingPublishEvent();

		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: admitRow,
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(published).toHaveLength(1);
		expect(published).toContainEqual({ detailType: RefreshContentExtractedEvent.detailType, detail: expect.objectContaining({
			url: URL,
			etag: '"new-etag"',
			lastModified: "Sun, 10 May 2026 12:00:00 GMT",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
			bodyHash: "a".repeat(64),
		}) });
	});

	it("forwards bodyHash from the command into RefreshContentExtractedEvent so the persister can land it on the freshness row", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const { publishEvent, published } = initRecordingPublishEvent();

		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: admitRow,
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		await handler(createSqsEvent({ ...DETAIL, bodyHash: "deadbeef".repeat(8) }), buildLambdaContext(), () => {});

		expect(published).toContainEqual({ detailType: RefreshContentExtractedEvent.detailType, detail: expect.objectContaining({
			url: URL,
			etag: '"new-etag"',
			lastModified: "Sun, 10 May 2026 12:00:00 GMT",
			contentFetchedAt: "2026-05-10T12:00:00.000Z",
			bodyHash: "deadbeef".repeat(8),
		}) });
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
			findRefreshAdmissionRow: admitRow,
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
		const { publishEvent, published } = initRecordingPublishEvent();

		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: admitRow,
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
		expect(published).toEqual([]);
	});

	it("reports a batch failure and does not publish when readRefreshHtml throws", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest
			.fn()
			.mockRejectedValue(new Error("S3 unavailable"));
		const putTierSource: PutTierSource = jest.fn();
		const { publishEvent, published } = initRecordingPublishEvent();

		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: admitRow,
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(putTierSource).not.toHaveBeenCalled();
		expect(published).toEqual([]);
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("does not publish when putTierSource throws so the downstream handler doesn't run with no tier-1 to read", async () => {
		const readRefreshHtml: ReadRefreshHtml = jest.fn().mockResolvedValue(HTML);
		const putTierSource: PutTierSource = jest
			.fn()
			.mockRejectedValue(new Error("s3 throttled"));
		const { publishEvent, published } = initRecordingPublishEvent();

		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: admitRow,
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml,
			putTierSource,
			publishEvent,
			logger: noopLogger,
		});

		const result = await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		expect(published).toEqual([]);
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
	it("binds candidate provenance to the staged attempt and the actual evaluation bytes", async () => {
		const putTierSource: PutTierSource = jest.fn();
		const { publishEvent, published } = initRecordingPublishEvent();
		const handler = initRefreshArticleContentHandler({ findRefreshAdmissionRow: admitRow, resolveOriginalUrl: async () => URL, readRefreshHtml: async () => HTML, putTierSource, publishEvent, logger: noopLogger });
		await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});
		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ html: HTML, metadata: expect.objectContaining({ attemptId: "attempt-1", originalUrl: URL, sourceUrl: URL, kind: "live", contentHash: createHash("sha256").update(HTML).digest("hex") }) }));
		expect(published).toContainEqual({ detailType: RefreshContentExtractedEvent.detailType, detail: expect.objectContaining({ saveAttemptId: "attempt-1", candidates: [{ id: expect.any(String), tier: "tier-1" }] }) });
	});

});


it("preserves actual response identity and raw evaluation separately from finalized reader HTML", async () => {
	const raw = "<html><body>Raw origin response with chrome</body></html>";
	const sourceUrl = "https://example.com/article?edition=current";
	const putTierSource = jest.fn();
	const handler = initRefreshArticleContentHandler({ findRefreshAdmissionRow: admitRow, resolveOriginalUrl: async () => URL, readRefreshHtml: async (_url, options) => options?.representation === "evaluation" ? raw : HTML, putTierSource, publishEvent: initRecordingPublishEvent().publishEvent, logger: noopLogger });
	await expect(handler(createSqsEvent({ ...DETAIL, sourceUrl }), buildLambdaContext(), () => {})).resolves.toEqual({ batchItemFailures: [] });
	expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ html: HTML, evaluationHtml: raw, metadata: expect.objectContaining({ kind: "live", sourceUrl, originalUrl: URL, contentHash: createHash("sha256").update(raw).digest("hex") }) }));
});

it("rejects stale refresh original proof before reading or writing artifacts", async () => {
	const readRefreshHtml = jest.fn();
	const putTierSource = jest.fn();
	const handler = initRefreshArticleContentHandler({ findRefreshAdmissionRow: admitRow, resolveOriginalUrl: async () => URL, readRefreshHtml, putTierSource, publishEvent: initRecordingPublishEvent().publishEvent, logger: noopLogger });
	await expect(handler(createSqsEvent({ ...DETAIL, sourceOriginalUrl: "https://different.example/article" }), buildLambdaContext(), () => {})).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	expect(readRefreshHtml).not.toHaveBeenCalled();
	expect(putTierSource).not.toHaveBeenCalled();
});

it("logs, writes the tier-1 candidate, announces it, then logs again, with exactly these arguments", async () => {
	const trace: unknown[][] = [];
	const record = (level: string) => (...args: unknown[]) => {
		trace.push([level, ...args]);
	};
	const raw = "<html><body>Raw origin response</body></html>";
	const handler = initRefreshArticleContentHandler({
		findRefreshAdmissionRow: admitRow,
		resolveOriginalUrl: async () => URL,
		readRefreshHtml: async (_url, options) => options?.representation === "evaluation" ? raw : HTML,
		putTierSource: async (params) => {
			trace.push(["putTierSource", params]);
			return params.metadata;
		},
		publishEvent: async (event, detail) => {
			trace.push(["publishEvent", event.detailType, detail]);
		},
		logger: { info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") },
	});

	await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

	const metadata = candidateProvenance({ metadata: { ...DETAIL.metadata, estimatedReadTime: DETAIL.estimatedReadTime }, html: HTML, evaluationHtml: raw, attemptId: SaveAttemptIdSchema.parse("attempt-1"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: DETAIL.contentFetchedAt });
	assert.deepEqual(trace, [
		["info", "[RefreshArticleContent] processing", { url: URL }],
		["putTierSource", { url: URL, tier: "tier-1", html: HTML, evaluationHtml: raw, metadata }],
		["publishEvent", RefreshContentExtractedEvent.detailType, { saveAttemptId: "attempt-1", candidates: [{ id: metadata.id, tier: "tier-1" }], url: URL, etag: DETAIL.etag, lastModified: DETAIL.lastModified, contentFetchedAt: DETAIL.contentFetchedAt, bodyHash: DETAIL.bodyHash }],
		["info", "[RefreshArticleContent] tier-1 source written + event published", { url: URL }],
	]);
});

describe("initRefreshArticleContentHandler admission gate", () => {
	type Published = { detailType: string; detail: unknown };

	function harness(deps: {
		findRefreshAdmissionRow: FindRefreshAdmissionRow;
		resolveOriginalUrl?: (url: string) => Promise<string>;
		readRefreshHtml?: ReadRefreshHtml;
		publishEvent?: (published: Published) => Promise<void>;
	}) {
		const tierWrites: Array<{ tier: string; html: string }> = [];
		const published: Published[] = [];
		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: deps.findRefreshAdmissionRow,
			resolveOriginalUrl: deps.resolveOriginalUrl ?? (async (url) => url),
			readRefreshHtml: deps.readRefreshHtml ?? (async () => HTML),
			putTierSource: async (params) => {
				tierWrites.push({ tier: params.tier, html: params.html });
				return params.metadata;
			},
			publishEvent: async (event, detail) => {
				const entry = { detailType: event.detailType, detail };
				await deps.publishEvent?.(entry);
				published.push(entry);
			},
			logger: noopLogger,
		});
		const run = () => handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});
		return { run, tierWrites, published };
	}

	function skipped(reason: string): Published {
		return {
			detailType: RefreshArticleContentSkippedEvent.detailType,
			detail: { url: URL, saveAttemptId: "attempt-1", contentFetchedAt: DETAIL.contentFetchedAt, reason },
		};
	}

	it("skips a purged row before resolving identity", async () => {
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => ({ purgedAt: "2026-05-11T00:00:00.000Z", crawlStatus: "ready" }),
			resolveOriginalUrl: async () => {
				throw new Error("identity must not be resolved for a purged row");
			},
		});

		assert.deepEqual(await run(), { batchItemFailures: [] });
		assert.deepEqual(tierWrites, []);
		assert.deepEqual(published, [skipped("purged")]);
	});

	it("does not recreate tier-1 after a purge then re-save", async () => {
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => ({ savedAt: "2026-05-10T12:00:01.000Z" }),
		});

		assert.deepEqual(await run(), { batchItemFailures: [] });
		assert.deepEqual(tierWrites, []);
		assert.deepEqual(published, [skipped("superseded")]);
	});

	it("skips an unsupported row", async () => {
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => ({ crawlStatus: "unsupported", contentFetchedAt: "2026-05-09T12:00:00.000Z" }),
		});

		assert.deepEqual(await run(), { batchItemFailures: [] });
		assert.deepEqual(tierWrites, []);
		assert.deepEqual(published, [skipped("unsupported")]);
	});

	it("admits a failed row older than the message", async () => {
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => ({ crawlStatus: "failed", contentFetchedAt: "2026-05-09T12:00:00.000Z" }),
		});

		assert.deepEqual(await run(), { batchItemFailures: [] });
		assert.deepEqual(tierWrites, [{ tier: "tier-1", html: HTML }]);
		assert.deepEqual(published.map(({ detailType }) => detailType), [RefreshContentExtractedEvent.detailType]);
	});

	it("writes once and skips the second run of the same message after its commit", async () => {
		let row: { crawlStatus: string; contentFetchedAt: string } = { crawlStatus: "ready", contentFetchedAt: "2026-05-09T12:00:00.000Z" };
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => row,
			publishEvent: async ({ detailType }) => {
				if (detailType === RefreshContentExtractedEvent.detailType) row = { ...row, contentFetchedAt: DETAIL.contentFetchedAt };
			},
		});

		assert.deepEqual(await run(), { batchItemFailures: [] });
		assert.deepEqual(await run(), { batchItemFailures: [] });
		assert.deepEqual(tierWrites, [{ tier: "tier-1", html: HTML }]);
		assert.deepEqual(published.map(({ detailType }) => detailType), [RefreshContentExtractedEvent.detailType, RefreshArticleContentSkippedEvent.detailType]);
		assert.deepEqual(published[1], skipped("superseded"));
	});

	it("skips a retry once a later commit has advanced the clock", async () => {
		let row = { crawlStatus: "ready", contentFetchedAt: "2026-05-09T12:00:00.000Z" };
		let eventBusDown = true;
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => row,
			publishEvent: async () => {
				if (eventBusDown) throw new Error("event bus unavailable");
			},
		});

		assert.deepEqual(await run(), { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		row = { crawlStatus: "ready", contentFetchedAt: "2026-05-10T13:00:00.000Z" };
		eventBusDown = false;
		assert.deepEqual(await run(), { batchItemFailures: [] });

		assert.deepEqual(tierWrites, [{ tier: "tier-1", html: HTML }]);
		assert.deepEqual(published, [skipped("superseded")]);
	});

	it.each([
		["body", undefined],
		["evaluation copy", "evaluation"],
	])("treats an expired staged %s as a skip", async (_label, expiredRepresentation) => {
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: admitRow,
			readRefreshHtml: async (_url, options) => options.representation === expiredRepresentation ? undefined : HTML,
		});

		assert.deepEqual(await run(), { batchItemFailures: [] });
		assert.deepEqual(tierWrites, []);
		assert.deepEqual(published, [skipped("staged-html-expired")]);
	});

	it("still fails the record on a table read error", async () => {
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => {
				throw new Error("ProvisionedThroughputExceededException");
			},
		});

		assert.deepEqual(await run(), { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(tierWrites, []);
		assert.deepEqual(published, []);
	});

	it("fails the record when publishing the skip fact fails, so a retry decides again", async () => {
		const { run, tierWrites, published } = harness({
			findRefreshAdmissionRow: async () => ({ purgedAt: "2026-05-11T00:00:00.000Z" }),
			publishEvent: async () => {
				throw new Error("event bus unavailable");
			},
		});

		assert.deepEqual(await run(), { batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		assert.deepEqual(tierWrites, []);
		assert.deepEqual(published, []);
	});

	it("logs the skip with its reason and the message's fetch time", async () => {
		const trace: unknown[][] = [];
		const handler = initRefreshArticleContentHandler({
			findRefreshAdmissionRow: async () => ({ crawlStatus: "unsupported" }),
			resolveOriginalUrl: async (url) => url,
			readRefreshHtml: async () => HTML,
			putTierSource: async (params) => params.metadata,
			publishEvent: async () => {},
			logger: { info: (...args: unknown[]) => trace.push(args), warn: () => {}, error: () => {}, debug: () => {} },
		});

		await handler(createSqsEvent(DETAIL), buildLambdaContext(), () => {});

		assert.deepEqual(trace, [
			["[RefreshArticleContent] processing", { url: URL }],
			["[RefreshArticleContent] skipped", { url: URL, reason: "unsupported", contentFetchedAt: DETAIL.contentFetchedAt }],
		]);
	});
});
