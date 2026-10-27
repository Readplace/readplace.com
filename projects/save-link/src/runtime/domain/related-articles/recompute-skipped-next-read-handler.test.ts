import { articleDestinationUrl } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	MarkRelatedArticlesOutcome,
	RelatedCandidate,
	RelatedTargetArticle,
	RelatedTargetLookup,
	SkippedNextReadSave,
} from "@packages/provider-contracts/related-articles";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent } from "aws-lambda";
import { RelatedArticlesComputedEvent } from "./index";
import type { RelatedArticlesComputedDetail } from "./index";
import type { RelatedCandidatePools } from "./related-articles-candidates";
import type {
	SelectRelatedArticles,
	SelectRelatedArticlesParams,
} from "./related-articles-selector";
import { initRecomputeSkippedNextReadHandler } from "./recompute-skipped-next-read-handler";

const USER_ID = UserIdSchema.parse("00000000000000000000000000000001");
const OTHER_USER_ID = UserIdSchema.parse("00000000000000000000000000000002");
const TARGET_URL = "https://example.com/target";
const NOW = new Date("2026-10-26T10:00:00.000Z");
const READABLE_AT = new Date("2026-10-26T09:00:00.000Z");
const BEFORE_READABLE = new Date("2026-10-26T08:59:00.000Z");
const AFTER_READABLE = new Date("2026-10-26T09:01:00.000Z");

function createSqsEvent(body: string): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body,
			attributes: {
				ApproximateReceiveCount: "1",
				SentTimestamp: "1620000000000",
				SenderId: "TESTID",
				ApproximateFirstReceiveTimestamp: "1620000000001",
			},
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:ComputeRelatedArticles",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const contentChangedEvent = createSqsEvent(
	JSON.stringify({ "detail-type": "CanonicalContentChanged", detail: { url: TARGET_URL } }),
);

function readableTarget(overrides: Partial<RelatedTargetArticle> = {}): RelatedTargetArticle {
	return {
		destinationUrl: articleDestinationUrl({ url: TARGET_URL, displayUrl: undefined }),
		hasSummary: false,
		crawlStatus: "ready",
		title: "The target",
		siteName: "Example",
		description: "An excerpt",
		hasStubMetadata: false,
		readerAvailableAt: READABLE_AT,
		...overrides,
	};
}

function candidates(count: number): RelatedCandidate[] {
	return Array.from({ length: count }, (_unused, index) => ({
		destinationUrl: articleDestinationUrl({ url: `https://example.com/earlier-${index}`, displayUrl: undefined }),
		url: `https://example.com/earlier-${index}`,
		title: `earlier ${index}`,
		siteName: "Example",
		description: "",
	}));
}

function fakeLogger() {
	return { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

interface HandlerOverrides {
	targetLookup?: RelatedTargetLookup;
	skippedSaves?: readonly SkippedNextReadSave[];
	pools?: RelatedCandidatePools;
	selectRelatedArticles?: SelectRelatedArticles;
	markOutcome?: MarkRelatedArticlesOutcome;
	logger?: HutchLogger;
}

function createHandler(overrides: HandlerOverrides = {}) {
	const lookups: Array<{ url: string; options?: { consistentRead: boolean } }> = [];
	const listed: string[] = [];
	const ready: Array<{ userId: string; url: string; relatedArticles: readonly { url: string }[] }> = [];
	const skipped: Array<{ userId: string; url: string; at: Date }> = [];
	const published: RelatedArticlesComputedDetail[] = [];
	const selected: SelectRelatedArticlesParams[] = [];
	const publishEvent: PublishEvent = async (_event, detail) => {
		published.push(RelatedArticlesComputedEvent.detailSchema.parse(detail));
	};

	const handler = initRecomputeSkippedNextReadHandler({
		findRelatedTargetArticle: async (url, options) => {
			lookups.push({ url, options });
			return overrides.targetLookup ?? { state: "found", article: readableTarget() };
		},
		findSkippedNextReadSaves: async (url) => {
			listed.push(url);
			return overrides.skippedSaves ?? [{ userId: USER_ID, skippedAt: BEFORE_READABLE }];
		},
		gatherRelatedCandidatePools: async () =>
			overrides.pools ?? { unreadCandidates: candidates(150), readCandidates: [], awaitingCrawl: 0 },
		selectRelatedArticles: async (params) => {
			selected.push(params);
			return overrides.selectRelatedArticles
				? overrides.selectRelatedArticles(params)
				: {
						kind: "ready", samples: [], droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0,
						related: [{ url: "https://example.com/earlier-0", reason: "Same argument" }],
						inputTokens: 120,
						outputTokens: 30,
						cacheHitInputTokens: 80,
						cacheMissInputTokens: 40,
					};
		},
		replaceSkippedRelatedArticlesWithReady: async (params) => {
			ready.push({ userId: params.userId, url: params.url, relatedArticles: params.relatedArticles });
			return overrides.markOutcome ?? "stored";
		},
		replaceSkippedRelatedArticlesWithSkip: async (params) => {
			skipped.push({ userId: params.userId, url: params.url, at: params.at });
			return overrides.markOutcome ?? "stored";
		},
		publishEvent,
		now: () => NOW,
		logger: overrides.logger ?? noopLogger,
	});

	return { handler, lookups, listed, ready, skipped, published, selected };
}

describe("initRecomputeSkippedNextReadHandler", () => {
	it("recomputes a save skipped before its article became readable and stores it through the replace write", async () => {
		const logger = fakeLogger();
		const { handler, ready, skipped, published } = createHandler({ logger });

		const result = await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(ready).toEqual([{
			userId: USER_ID,
			url: TARGET_URL,
			relatedArticles: [{ url: "https://example.com/earlier-0", reason: "Same argument" }],
		}]);
		expect(skipped).toEqual([]);
		expect(published).toEqual([{
			url: TARGET_URL,
			userId: USER_ID,
			outcome: "ready",
			relatedCount: 1,
			inputTokens: 120,
			outputTokens: 30,
		}]);
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedArticles] content changed", {
			url: TARGET_URL,
			recomputing: 1,
		});
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedArticles] completed", {
			sampleCount: 0,
			samples: [],
			agreement: undefined,
			url: TARGET_URL,
			relatedCount: 1,
			droppedNoSharedWord: 0,
			droppedReasonNotAboutPick: 0,
			inputTokens: 120,
			outputTokens: 30,
			cacheHitInputTokens: 80,
			cacheMissInputTokens: 40,
			trigger: "content-changed",
		});
	});

	it("leaves a save skipped after its article became readable alone", async () => {
		const logger = fakeLogger();
		const { handler, ready, skipped, published, selected } = createHandler({
			logger,
			skippedSaves: [{ userId: USER_ID, skippedAt: AFTER_READABLE }],
		});

		const result = await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect({ ready, skipped, published, selected }).toEqual({ ready: [], skipped: [], published: [], selected: [] });
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedArticles] content changed", {
			url: TARGET_URL,
			recomputing: 0,
		});
	});

	it.each<{ reason: string; targetLookup: RelatedTargetLookup }>([
		{ reason: "absent", targetLookup: { state: "absent" } },
		{ reason: "purged", targetLookup: { state: "purged" } },
		{ reason: "not an article host", targetLookup: { state: "not-an-article" } },
		{ reason: "not readable", targetLookup: { state: "found", article: readableTarget({ readerAvailableAt: undefined }) } },
		{
			reason: "crawl produced no metadata to compare",
			targetLookup: { state: "found", article: readableTarget({ hasStubMetadata: true }) },
		},
	])("recomputes nothing and writes nothing for a target ruled out as $reason", async ({ reason, targetLookup }) => {
		const logger = fakeLogger();
		const { handler, listed, ready, skipped, published, selected } = createHandler({ logger, targetLookup });

		const result = await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect({ listed, ready, skipped, published, selected }).toEqual({
			listed: [],
			ready: [],
			skipped: [],
			published: [],
			selected: [],
		});
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedArticles] content changed", {
			url: TARGET_URL,
			recomputing: 0,
			reason,
		});
	});

	it("computes every eligible save, one after another", async () => {
		const { handler, ready, published } = createHandler({
			skippedSaves: [
				{ userId: USER_ID, skippedAt: BEFORE_READABLE },
				{ userId: OTHER_USER_ID, skippedAt: BEFORE_READABLE },
			],
		});

		await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(ready.map((write) => write.userId)).toEqual([USER_ID, OTHER_USER_ID]);
		expect(published.map((detail) => detail.userId)).toEqual([USER_ID, OTHER_USER_ID]);
	});

	it("replaces the skip and logs the skipped line with the trigger when the recompute still finds no shared words", async () => {
		const logger = fakeLogger();
		const { handler, ready, skipped, published } = createHandler({
			logger,
			selectRelatedArticles: async () => ({ kind: "no-shared-words", bestScore: 3, candidateCount: 150 }),
		});

		await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(ready).toEqual([]);
		expect(skipped).toEqual([{ userId: USER_ID, url: TARGET_URL, at: NOW }]);
		expect(published[0]?.outcome).toBe("skipped");
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedArticles] skipped", {
			url: TARGET_URL,
			reason: "no earlier save shares the saved article's words",
			receiveCount: 1,
			crawlStatus: "ready",
			bestScore: 3,
			candidateCount: 150,
			hasSummary: false,
			trigger: "content-changed",
		});
	});

	it("publishes nothing and logs the superseded line with the trigger when the row is no longer skipped", async () => {
		const logger = fakeLogger();
		const { handler, published } = createHandler({ logger, markOutcome: "superseded" });

		const result = await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(published).toEqual([]);
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedArticles] superseded", {
			url: TARGET_URL,
			trigger: "content-changed",
		});
	});

	it("retries and logs the info wait when the reader's thin pile is still crawling", async () => {
		const logger = fakeLogger();
		const { handler, ready, skipped, published } = createHandler({
			logger,
			pools: { unreadCandidates: candidates(20), readCandidates: [], awaitingCrawl: 40 },
		});

		const result = await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect({ ready, skipped, published }).toEqual({ ready: [], skipped: [], published: [] });
		expect(logger.info).toHaveBeenCalledWith(
			"[ComputeRelatedArticles] waiting for crawl metadata; redelivery scheduled",
			{ url: TARGET_URL, messageId: "msg-1", receiveCount: 1, crawlStatus: "ready", trigger: "content-changed" },
		);
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("retries and logs the error line when the selection fails", async () => {
		const logger = fakeLogger();
		const failure = new Error("model unavailable");
		const { handler, published } = createHandler({
			logger,
			selectRelatedArticles: async () => {
				throw failure;
			},
		});

		const result = await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(published).toEqual([]);
		expect(logger.error).toHaveBeenCalledWith("[ComputeRelatedArticles] record failed", {
			messageId: "msg-1",
			error: failure,
			trigger: "content-changed",
		});
	});

	it("reads the target with a strongly consistent read", async () => {
		const { handler, lookups } = createHandler();

		await handler(contentChangedEvent, buildLambdaContext(), () => {});

		expect(lookups).toEqual([{ url: TARGET_URL, options: { consistentRead: true } }]);
	});

	it("retries a message whose detail does not match the event", async () => {
		const logger = fakeLogger();
		const { handler, lookups } = createHandler({ logger });

		const result = await handler(
			createSqsEvent(JSON.stringify({ detail: { notAUrl: true } })),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(lookups).toEqual([]);
		expect(logger.error).toHaveBeenCalledWith(
			"[ComputeRelatedArticles] record failed",
			expect.objectContaining({ messageId: "msg-1", trigger: "content-changed" }),
		);
	});
});
