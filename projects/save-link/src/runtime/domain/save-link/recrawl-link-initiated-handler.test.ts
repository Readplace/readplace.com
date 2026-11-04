import { noopLogger } from "@packages/hutch-logger";
import { markCrawlExhausted, markCrawlNotFound } from "@packages/domain/article-aggregate";
import { RecrawlContentExtractedEvent } from "@packages/hutch-infra-components";
import { initRecrawlLinkInitiatedHandler } from "./recrawl-link-initiated-handler";
import type {
	CrawlAndFinalizeArticle,
	CrawlAndFinalizeResult,
	FinalizedArticle,
} from "@packages/finalize-article";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(detail: { url: string }): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body: JSON.stringify({ detail: { ...detail, saveAttemptId: "attempt-1" } }),
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:RecrawlLinkInitiated",
			awsRegion: "ap-southeast-2",
		}],
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
	evaluationHtml: stubFinalizedArticle.html,
	bodyHash: "a".repeat(64),
};

const rejectingEmitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = async () => {
	throw new Error("emitSimpleCrawlUnsupported invoked unexpectedly");
};

type HandlerDeps = Parameters<typeof initRecrawlLinkInitiatedHandler>[0];

const fixedNow = () => new Date("2026-04-30T12:00:00.000Z");

function createHandler(overrides: Partial<HandlerDeps> = {}) {
	return initRecrawlLinkInitiatedHandler({
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		prepareArticleIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
		resolveOriginalUrl: async (url) => url,
		crawlAndFinalizeArticle: (async () => fetchedResult) as CrawlAndFinalizeArticle,
		emitSimpleCrawlUnsupported: rejectingEmitSimpleCrawlUnsupported,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		isSiteRuleUrl: () => false,
		publishEvent: jest.fn().mockResolvedValue(undefined),
		now: fixedNow,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		findContentSourceUrl: async () => undefined,
		...overrides,
	});
}

describe("initRecrawlLinkInitiatedHandler", () => {
	it("crawls the URL and emits RecrawlContentExtractedEvent on success", async () => {
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const handler = createHandler({ publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

		expect(publishEvent).toHaveBeenCalledTimes(1);
		expect(publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, expect.objectContaining({
			url: "https://example.com/article",
			extractedAt: "2026-04-30T12:00:00.000Z",
		}));
	});

	it("terminalises an origin failure in-process with its classified reason and reports no batch failure, so a refused origin never dead-letters", async () => {
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);

		const handler = createHandler({ crawlAndFinalizeArticle, transitionAndPersist, publishEvent });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlExhausted, {
			url: "https://example.com/unreachable",
			input: { reason: { kind: "fetch-failed" }, receiveCount: 1 },
		});
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("reports a batch failure when terminalising the origin failure itself fails, so the record is not lost", async () => {
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });
		const transitionAndPersist = jest.fn().mockRejectedValue(new Error("dynamodb down"));

		const handler = createHandler({ crawlAndFinalizeArticle, transitionAndPersist });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/unreachable" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("terminalises a permanently-dead link (HTTP 404) via markCrawlNotFound and neither emits RecrawlContentExtractedEvent nor reports a batch failure — recrawling a page the origin no longer serves can never succeed", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "not-found", httpStatus: 404 });

		const handler = createHandler({ crawlAndFinalizeArticle, transitionAndPersist, publishEvent });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/gone" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, {
			url: "https://example.com/gone",
			input: { reason: { kind: "not-found", httpStatus: 404 } },
		});
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("defers an edge-blocked recrawl (HTTP 403) to the render ladder and reports no batch failure", async () => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403 });

		const handler = createHandler({ emitSimpleCrawlUnsupported, crawlAndFinalizeArticle, transitionAndPersist, publishEvent });

		const result = await handler(
			createSqsEvent({ url: "https://example.com/walled" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({ unsupportedReason: "blocked" }));
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(publishEvent).not.toHaveBeenCalled();
	});

	it("emits SimpleCrawlUnsupportedEvent with recrawl=true when the crawl returns unsupported and does NOT publish RecrawlContentExtractedEvent itself (the policy → comprehensive chain will)", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<
			ReturnType<EmitSimpleCrawlUnsupported>,
			Parameters<EmitSimpleCrawlUnsupported>
		>().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const publishEvent = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "unsupported",
			reason: "non-html content type: application/pdf",
		});

		const handler = createHandler({
			crawlAndFinalizeArticle,
			emitSimpleCrawlUnsupported,
			transitionAndPersist,
			publishEvent,
		});

		const result = await handler(
			createSqsEvent({ url: "https://example.com/doc.pdf" }),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [] });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledTimes(1);
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({
			url: "https://example.com/doc.pdf",
			userId: undefined,
			recrawl: true,
		}));
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

		const result = await handler(invalidEvent, buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("logs a tier-1 crawl-failed at warn (not error) so it stays off the errors dashboard", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });

		const handler = createHandler({ crawlAndFinalizeArticle, logger });

		await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

		expect(logger.warn).toHaveBeenCalledWith(
			"[RecrawlLinkInitiated] crawl failed — terminalising in-process",
			expect.objectContaining({ url: "https://example.com/article" }),
		);
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("logs a genuine unexpected failure at error (not warn) so real bugs still surface on the dashboard", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const publishEvent = jest.fn().mockRejectedValue(new Error("eventbridge down"));

		const handler = createHandler({ logger, publishEvent });

		await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

		expect(logger.error).toHaveBeenCalledWith(
			"[RecrawlLinkInitiated] record failed",
			expect.objectContaining({ messageId: "msg-1" }),
		);
		expect(logger.warn).not.toHaveBeenCalled();
	});

	describe("an article with a recorded archive capture", () => {
		const capture = "https://web.archive.org/web/20081203185222/https://example.com/article";

		it("re-crawls the capture into the archive tier alongside the live page, then asks for one content judgement", async () => {
			const crawls: Parameters<CrawlAndFinalizeArticle>[0][] = [];
			const putTierSource = jest.fn().mockResolvedValue(undefined);
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				crawlAndFinalizeArticle: async (params) => {
					crawls.push(params);
					return fetchedResult;
				},
				putTierSource,
				publishEvent,
				findContentSourceUrl: async () => capture,
			});

			await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

			const writeContext = { url: "https://example.com/article", attemptId: "attempt-1" };
			expect(crawls).toEqual(expect.arrayContaining([{ url: "https://example.com/article", fetchUrl: capture, retainResponseBody: true, writeContext }, { url: "https://example.com/article", retainResponseBody: true, writeContext }]));
			expect(putTierSource.mock.calls.map(([params]) => params.tier)).toEqual(expect.arrayContaining(["tier-2", "tier-1"]));
			expect(publishEvent).toHaveBeenCalledTimes(1);
			expect(publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, expect.objectContaining({
				url: "https://example.com/article",
				extractedAt: "2026-04-30T12:00:00.000Z",
			}));
		});

		it("hands the capture to the deferred recrawl without a recrawl event when the live fetch is deferred, so the content judge runs once", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				crawlAndFinalizeArticle: async (params) => params.fetchUrl === capture ? fetchedResult : { status: "blocked", httpStatus: 403 },
				publishEvent,
				emitSimpleCrawlUnsupported,
				findContentSourceUrl: async () => capture,
			});

			const result = await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

			expect(result).toEqual({ batchItemFailures: [] });
			expect(emitSimpleCrawlUnsupported.mock.calls).toEqual([[expect.objectContaining({
				url: "https://example.com/article",
				recrawl: true,
				unsupportedReason: "blocked",
				candidates: [{ id: expect.any(String), tier: "tier-2" }],
			})]]);
			expect(publishEvent.mock.calls).toEqual([]);
		});

		it("still asks for a content judgement when the live page is gone but the capture was re-crawled", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				crawlAndFinalizeArticle: async (params) =>
					params.fetchUrl === undefined ? { status: "not-found", httpStatus: 404 } : fetchedResult,
				publishEvent,
				findContentSourceUrl: async () => capture,
			});

			const result = await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

			expect(result).toEqual({ batchItemFailures: [] });
			expect(publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, expect.objectContaining({
				url: "https://example.com/article",
				extractedAt: "2026-04-30T12:00:00.000Z",
			}));
		});

		it("asks the selector to retain verified content or mark no readable article when both crawls fail", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				crawlAndFinalizeArticle: async () => ({ status: "not-found", httpStatus: 404 }),
				publishEvent,
				findContentSourceUrl: async () => capture,
			});

			await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

			expect(publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, expect.objectContaining({ candidates: [], liveAttempt: { outcome: "no-body" } }));
		});

		it("carries why the live origin could not be reached to the selector when the capture also fails", async () => {
			const publishEvent = jest.fn().mockResolvedValue(undefined);
			const handler = createHandler({
				crawlAndFinalizeArticle: async (params) => params.fetchUrl === undefined
					? { status: "failed", reason: "crawl-failed", failure: { kind: "origin-unreachable", code: "ENOTFOUND" } }
					: { status: "not-found", httpStatus: 404 },
				publishEvent,
				findContentSourceUrl: async () => capture,
			});

			await handler(createSqsEvent({ url: "https://example.com/article" }), buildLambdaContext(), () => {});

			expect(publishEvent).toHaveBeenCalledWith(RecrawlContentExtractedEvent, expect.objectContaining({ candidates: [], liveAttempt: { outcome: "no-body", failureReason: { kind: "origin-unreachable", code: "ENOTFOUND" } } }));
		});
	});
});
