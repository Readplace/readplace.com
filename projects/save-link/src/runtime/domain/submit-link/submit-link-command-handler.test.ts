import { noopLogger } from "@packages/hutch-logger";
import { markCrawlBlocked, markCrawlExhausted } from "@packages/domain/article-aggregate";
import {
	MinutesSchema,
	ReaderArticleHashIdSchema,
	SaveableUrlSchema,
	validateSaveableUrl,
} from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import {
	QueueEntryCreatedEvent,
	TierContentExtractedEvent,
} from "@packages/hutch-infra-components";
import type {
	CrawlAndFinalizeArticle,
	CrawlAndFinalizeResult,
	FinalizedArticle,
} from "@packages/finalize-article";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initSubmitLinkCommandHandler } from "./submit-link-command-handler";

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const articleId = ReaderArticleHashIdSchema.parse("0123456789abcdef0123456789abcdef");
const exampleUrl = SaveableUrlSchema.parse("https://example.com/post");

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(
	details: Array<{ url: string; userId?: string; rawHtml?: string; provenance?: unknown }>,
): SQSEvent {
	return {
		Records: details.map((detail, index) => ({
			messageId: `msg-${index + 1}`,
			receiptHandle: `receipt-${index + 1}`,
			body: JSON.stringify({
				detail:
					detail.userId === undefined ? detail : { provenance: { kind: "web" }, ...detail },
			}),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:SubmitLinkCommand",
			awsRegion: "ap-southeast-2",
		})),
	};
}

function makeSaved(overrides: Partial<SavedArticle> = {}): SavedArticle {
	return {
		id: articleId,
		userId,
		url: exampleUrl,
		metadata: { title: "", siteName: "", excerpt: "", wordCount: 0 },
		estimatedReadTime: MinutesSchema.parse(0),
		status: "unread",
		savedAt: new Date("2026-06-01T00:00:00.000Z"),
		...overrides,
	};
}

const stubFinalizedArticle: FinalizedArticle = {
	html: "<p>Article content</p>",
	metadata: {
		title: "Test",
		siteName: "example.com",
		excerpt: "test",
		wordCount: 10,
		estimatedReadTime: 1,
		imageUrl: undefined,
	},
};

const fetchedResult: CrawlAndFinalizeResult = {
	status: "fetched",
	article: stubFinalizedArticle,
	bodyHash: "a".repeat(64),
};

const rejectingEmitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = async () => {
	throw new Error("emitSimpleCrawlUnsupported invoked unexpectedly");
};

type HandlerDeps = Parameters<typeof initSubmitLinkCommandHandler>[0];

const fixedNow = () => new Date("2026-06-01T12:00:00.000Z");
const allocatedSavedAt = new Date("2026-06-01T12:00:00.777Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initSubmitLinkCommandHandler({
		validateSaveableUrl,
		saveArticle: jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true }),
		allocateSavedAt: jest.fn().mockResolvedValue(allocatedSavedAt),
		recordInboxArticleQueued: jest.fn().mockResolvedValue(undefined),
		updateArticleStatus: jest.fn().mockResolvedValue(true),
		markCrawlPending: jest.fn().mockResolvedValue(undefined),
		markSummaryPending: jest.fn().mockResolvedValue(undefined),
		publishUpdateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		refreshArticleIfStale: jest.fn().mockResolvedValue({ action: "new" }),
		resolveCanonicalIdentity: async (url) => url,
		crawlAndFinalizeArticle: (async () => fetchedResult) as CrawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported: rejectingEmitSimpleCrawlUnsupported,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		now: fixedNow,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({
			tier0Status: "not_attempted",
			tier1Status: "not_attempted",
			pickedTier: "none",
		}),
		...overrides,
	});
}

/** The detail types published, in order — every accepted save emits LinkQueued,
 * so a test that cares about the crawl chain names what it expects beside it. */
function publishedDetailTypes(publishEvent: jest.Mock): string[] {
	return publishEvent.mock.calls.map((call) => call[0].detailType);
}

async function run(handler: ReturnType<typeof createHandler>, event: SQSEvent) {
	const response = await handler(event, buildLambdaContext(), () => undefined);
	if (!response) throw new Error("handler returned no response");
	return response;
}

describe("initSubmitLinkCommandHandler", () => {
	it("stub-saves a new URL, crawls tier-1 in-process, and emits TierContentExtractedEvent", async () => {
		const saveArticle = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const markCrawlPending = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const putTierSource = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ saveArticle, markCrawlPending, publishEvent, putTierSource });

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(saveArticle).toHaveBeenCalledWith(
			expect.objectContaining({ userId, url: exampleUrl, savedAt: allocatedSavedAt }),
		);
		expect(markCrawlPending).toHaveBeenCalledWith({ url: exampleUrl });
		expect(putTierSource).toHaveBeenCalledWith(
			expect.objectContaining({ url: exampleUrl, tier: "tier-1" }),
		);
		expect(publishEvent).toHaveBeenCalledWith(TierContentExtractedEvent, {
			url: exampleUrl,
			tier: "tier-1",
			userId,
			extractedAt: fixedNow().toISOString(),
		});
	});

	it("asks to resurface earlier saves for a newsletter link the reader did not already have, keyed on the alias target", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			publishEvent,
			resolveCanonicalIdentity: async () => "https://example.com/canonical",
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(publishEvent).toHaveBeenCalledWith(QueueEntryCreatedEvent, {
			url: "https://example.com/canonical",
			userId,
		});
	});

	it("asks nothing for a newsletter link already sitting in the reader's queue", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			publishEvent,
			saveArticle: jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: false, wroteUserArticle: true }),
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(publishedDetailTypes(publishEvent)).toEqual([
			"LinkQueued",
			"TierContentExtracted",
		]);
	});

	it("attaches an existing article without re-crawling: 'skip' freshness bumps the row and emits only the accepted-save fact", async () => {
		const saveArticle = jest.fn().mockResolvedValue({ saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true });
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle = jest.fn();
		const handler = createHandler({
			saveArticle,
			publishEvent,
			refreshArticleIfStale: jest.fn().mockResolvedValue({ action: "skip" }),
			crawlAndFinalizeArticle: crawlAndFinalizeArticle as unknown as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(saveArticle).toHaveBeenCalledWith(
			expect.objectContaining({ userId, url: exampleUrl }),
		);
		expect(crawlAndFinalizeArticle).not.toHaveBeenCalled();
		expect(publishedDetailTypes(publishEvent)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("resurfaces a previously-read article back to unread, exactly like the queue save button", async () => {
		const updateArticleStatus = jest.fn().mockResolvedValue(true);
		const handler = createHandler({
			saveArticle: jest
				.fn()
				.mockResolvedValue({ saved: makeSaved({ status: "read", readAt: new Date("2026-06-10T00:00:00.000Z") }), createdUserArticle: true, wroteUserArticle: true }),
			updateArticleStatus,
			refreshArticleIfStale: jest.fn().mockResolvedValue({ action: "skip" }),
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(updateArticleStatus).toHaveBeenCalledWith(articleId, userId, "unread");
	});

	it("completes the queue write and resurface before the tier-1 crawl starts", async () => {
		const order: string[] = [];
		const handler = createHandler({
			saveArticle: jest.fn().mockImplementation(async () => {
				order.push("saveArticle");
				return { saved: makeSaved({ status: "read", readAt: new Date() }), createdUserArticle: true, wroteUserArticle: true };
			}),
			updateArticleStatus: jest.fn().mockImplementation(async () => {
				order.push("resurface");
				return true;
			}),
			crawlAndFinalizeArticle: (async () => {
				order.push("crawl");
				return fetchedResult;
			}) as CrawlAndFinalizeArticle,
		});

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(order).toEqual(["saveArticle", "resurface", "crawl"]);
	});

	it("fails the record when the message carries rawHtml — the tier-0 submit path has no handler yet", async () => {
		const handler = createHandler();

		const response = await run(
			handler,
			createSqsEvent([{ url: exampleUrl, userId, rawHtml: "<html></html>" }]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("fails the record when the message is anonymous — the /view submit path has no handler yet", async () => {
		const handler = createHandler();

		const response = await run(handler, createSqsEvent([{ url: exampleUrl }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("fails a pre-provenance record still in flight at deploy, rather than reading it as an anonymous submission", async () => {
		const saveArticle = jest.fn();
		const handler = createHandler({ saveArticle });
		const event = createSqsEvent([{ url: exampleUrl }]);
		event.Records[0].body = JSON.stringify({ detail: { url: exampleUrl, userId } });

		const response = await run(handler, event);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).not.toHaveBeenCalled();
	});

	it("fails the record for an unsaveable URL instead of stub-saving garbage", async () => {
		const saveArticle = jest.fn();
		const handler = createHandler({ saveArticle });

		const response = await run(
			handler,
			createSqsEvent([{ url: "ftp://example.com/file", userId }]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
		expect(saveArticle).not.toHaveBeenCalled();
	});

	it("acks a tier-1-deferred crawl without emitting TierContentExtractedEvent — the comprehensive Lambda owns the next event", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			publishEvent,
			emitSimpleCrawlUnsupported,
			crawlAndFinalizeArticle: (async () => ({
				status: "unsupported",
				reason: "content-type application/pdf",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: exampleUrl,
			userId,
			recrawl: undefined,
		});
		expect(publishedDetailTypes(publishEvent)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("acks a tier-1-terminal crawl (origin no longer serves the page) without emitting a tier event", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			publishEvent,
			crawlAndFinalizeArticle: (async () => ({
				status: "not-found",
				httpStatus: 410,
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(publishedDetailTypes(publishEvent)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("acks an edge-blocked import (HTTP 403) after markCrawlBlocked and emits no tier event — dead-lettering would let the DLQ handler relabel the block as exhausted-retries", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			transitionAndPersist,
			publishEvent,
			crawlAndFinalizeArticle: (async () => ({
				status: "blocked",
				httpStatus: 403,
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
			url: exampleUrl,
			input: { reason: { kind: "blocked", cause: "edge-block" } },
		});
		expect(publishedDetailTypes(publishEvent)).toEqual(["LinkQueued", "QueueEntryCreated"]);
	});

	it("terminalises the row as fetch-failed and acks the record when the tier-1 crawl throws a transport failure — a first receive is not an exhausted retry budget", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			transitionAndPersist,
			crawlAndFinalizeArticle: (async () => ({
				status: "failed",
				reason: "crawl-failed",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: exampleUrl,
			input: { reason: { kind: "fetch-failed" }, receiveCount: 1 },
		});
	});

	it("preserves the parse-error detail the worker already wrote instead of clobbering it with a retry label", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			transitionAndPersist,
			crawlAndFinalizeArticle: (async () => ({
				status: "failed",
				reason: "Readability returned null",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(transitionAndPersist).toHaveBeenLastCalledWith(markCrawlExhausted, {
			url: exampleUrl,
			input: {
				reason: { kind: "parse-error", detail: "Readability returned null" },
				receiveCount: 1,
			},
		});
	});

	it("still terminalises with the receive count when the failure came from the worker's own storage write, not from the crawl", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({
			transitionAndPersist,
			putTierSource: jest.fn().mockRejectedValue(new Error("S3 PutObject failed")),
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([]);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: exampleUrl,
			input: { reason: { kind: "exhausted-retries", receiveCount: 1 }, receiveCount: 1 },
		});
	});

	it("fails the record when the in-process terminalisation itself fails, so the row is not silently left pending", async () => {
		const handler = createHandler({
			transitionAndPersist: jest.fn().mockRejectedValue(new Error("DDB throttled")),
			crawlAndFinalizeArticle: (async () => ({
				status: "failed",
				reason: "crawl-failed",
			})) as CrawlAndFinalizeArticle,
		});

		const response = await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("processes the rest of the batch when one record fails", async () => {
		const handler = createHandler();

		const response = await run(
			handler,
			createSqsEvent([
				{ url: "not a url", userId },
				{ url: exampleUrl, userId },
			]),
		);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("fails the record when the body is not JSON", async () => {
		const handler = createHandler();
		const event = createSqsEvent([{ url: exampleUrl, userId }]);
		event.Records[0].body = "not json";

		const response = await run(handler, event);

		expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
	});

	it("announces the accepted save with the submitted url, so a reader's saved-link view can match it", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ publishEvent });

		await run(handler, createSqsEvent([{ url: exampleUrl, userId }]));

		const queued = publishEvent.mock.calls.find((call) => call[0].detailType === "LinkQueued");
		expect(queued?.[1]).toEqual({ url: exampleUrl, userId });
	});

	it("stamps the reader's first inbox article once for an email-provenance save", async () => {
		const recordInboxArticleQueued = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ recordInboxArticleQueued });

		const response = await run(
			handler,
			createSqsEvent([
				{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "letters@example.com" } },
			]),
		);

		expect(response.batchItemFailures).toEqual([]);
		expect(recordInboxArticleQueued).toHaveBeenCalledTimes(1);
		expect(recordInboxArticleQueued).toHaveBeenCalledWith({ userId });
	});

	it.each([
		{ kind: "web" },
		{ kind: "client", clientName: "chrome" },
		{ kind: "import" },
		{ kind: "mcp", registeredName: "claude" },
	])("leaves the inbox stamp untouched for a $kind save", async (provenance) => {
		const recordInboxArticleQueued = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ recordInboxArticleQueued });

		await run(handler, createSqsEvent([{ url: exampleUrl, userId, provenance }]));

		expect(recordInboxArticleQueued).not.toHaveBeenCalled();
	});

	it("stamps after the queue write and before the tier-1 crawl", async () => {
		const order: string[] = [];
		const handler = createHandler({
			saveArticle: jest.fn().mockImplementation(async () => {
				order.push("saveArticle");
				return { saved: makeSaved(), createdUserArticle: true, wroteUserArticle: true };
			}),
			recordInboxArticleQueued: jest.fn().mockImplementation(async () => {
				order.push("stamp");
			}),
			crawlAndFinalizeArticle: (async () => {
				order.push("crawl");
				return fetchedResult;
			}) as CrawlAndFinalizeArticle,
		});

		await run(
			handler,
			createSqsEvent([
				{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "letters@example.com" } },
			]),
		);

		expect(order).toEqual(["saveArticle", "stamp", "crawl"]);
	});

	it("logs a warning, keeps the accepted save and still crawls when the inbox stamp throws", async () => {
		const crawlAndFinalizeArticle = jest.fn().mockResolvedValue(fetchedResult);
		const warnings: unknown[] = [];
		const handler = createHandler({
			recordInboxArticleQueued: jest.fn().mockRejectedValue(new Error("DDB throttled")),
			crawlAndFinalizeArticle: crawlAndFinalizeArticle as unknown as CrawlAndFinalizeArticle,
			logger: {
				...noopLogger,
				warn: (message, context) => {
					warnings.push([message, context]);
				},
			},
		});

		const response = await run(
			handler,
			createSqsEvent([
				{ url: exampleUrl, userId, provenance: { kind: "email", senderEmail: "letters@example.com" } },
			]),
		);

		expect(response.batchItemFailures).toEqual([]);
		expect(crawlAndFinalizeArticle).toHaveBeenCalled();
		expect(warnings).toEqual([
			[
				"[SubmitLinkCommand] inbox onboarding stamp failed — continuing",
				{ url: exampleUrl, error: "Error: DDB throttled" },
			],
		]);
	});
});
