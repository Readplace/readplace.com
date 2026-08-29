import { UserIdSchema } from "@packages/domain/user";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	MarkRelatedArticlesOutcome,
	RelatedArticles,
	RelatedCandidate,
	RelatedTargetArticle,
	RelatedTargetLookup,
} from "@packages/provider-contracts/related-articles";
import type { RelatedCandidatePools } from "./related-articles-candidates";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { initComputeRelatedArticlesHandler } from "./compute-related-articles-handler";
import { RelatedArticlesComputedEvent } from "./index";
import type { RelatedArticlesComputedDetail } from "./index";
import type {
	SelectRelatedArticles,
	SelectRelatedArticlesParams,
} from "./related-articles-selector";

const USER_ID = UserIdSchema.parse("00000000000000000000000000000001");
const TARGET_URL = "https://example.com/target";
const NOW = new Date("2026-08-04T10:00:00.000Z");

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function createSqsEvent(body: string): SQSEvent {
	return {
		Records: [{
			messageId: "msg-1",
			receiptHandle: "receipt-1",
			body,
			attributes: stubAttributes,
			messageAttributes: {},
			md5OfBody: "",
			eventSource: "aws:sqs",
			eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:ComputeRelatedArticles",
			awsRegion: "ap-southeast-2",
		}],
	};
}

const queueEntryEvent = createSqsEvent(
	JSON.stringify({ detail: { url: TARGET_URL, userId: USER_ID } }),
);

function crawledTarget(overrides: Partial<RelatedTargetArticle> = {}): RelatedTargetArticle {
	return {
		crawlStatus: "ready",
		title: "The target",
		siteName: "Example",
		description: "An excerpt",
		hasStubMetadata: false,
		...overrides,
	};
}

function candidates(prefix: string, count: number): RelatedCandidate[] {
	return Array.from({ length: count }, (_unused, index) => ({
		url: `https://example.com/${prefix}-${index}`,
		title: `${prefix} ${index}`,
		siteName: "Example",
		description: "",
	}));
}

interface HandlerOverrides {
	existing?: RelatedArticles;
	targetLookup?: RelatedTargetLookup;
	pools?: RelatedCandidatePools;
	selectRelatedArticles?: SelectRelatedArticles;
	markOutcome?: MarkRelatedArticlesOutcome;
	logger?: HutchLogger;
}

function createHandler(overrides: HandlerOverrides = {}) {
	const ready: Array<{ url: string; relatedArticles: readonly { url: string }[] }> = [];
	const skipped: Array<{ url: string; at: Date }> = [];
	const published: RelatedArticlesComputedDetail[] = [];
	const selected: SelectRelatedArticlesParams[] = [];
	const publishEvent: PublishEvent = async (_event, detail) => {
		published.push(RelatedArticlesComputedEvent.detailSchema.parse(detail));
	};

	const handler = initComputeRelatedArticlesHandler({
		findRelatedArticles: async () => overrides.existing ?? { status: "pending" },
		findRelatedTargetArticle: async () =>
			overrides.targetLookup ?? { state: "found", article: crawledTarget() },
		gatherRelatedCandidatePools: async () =>
			overrides.pools ?? {
				unreadCandidates: candidates("earlier", 150),
				readCandidates: [],
				awaitingCrawl: 0,
			},
		selectRelatedArticles: async (params) => {
			selected.push(params);
			return overrides.selectRelatedArticles
				? overrides.selectRelatedArticles(params)
				: {
						kind: "ready",
						related: [{ url: "https://example.com/earlier-0", reason: "Same argument" }],
						inputTokens: 120,
						outputTokens: 30,
					};
		},
		markRelatedArticlesReady: async (params) => {
			ready.push({ url: params.url, relatedArticles: params.relatedArticles });
			return overrides.markOutcome ?? "stored";
		},
		markRelatedArticlesSkipped: async (params) => {
			skipped.push({ url: params.url, at: params.at });
			return overrides.markOutcome ?? "stored";
		},
		publishEvent,
		now: () => NOW,
		logger: overrides.logger ?? noopLogger,
	});

	return { handler, ready, skipped, published, selected };
}

describe("initComputeRelatedArticlesHandler", () => {
	it("stores the selected relations and announces the outcome", async () => {
		const { handler, ready, published } = createHandler();

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(ready).toEqual([
			{
				url: TARGET_URL,
				relatedArticles: [{ url: "https://example.com/earlier-0", reason: "Same argument" }],
			},
		]);
		expect(published).toEqual([
			{
				url: TARGET_URL,
				userId: USER_ID,
				outcome: "ready",
				relatedCount: 1,
				inputTokens: 120,
				outputTokens: 30,
			},
		]);
	});

	it("announces nothing when another computation had already settled the row", async () => {
		const { handler, ready, published } = createHandler({ markOutcome: "superseded" });

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(ready).toHaveLength(1);
		expect(published).toEqual([]);
	});

	it("announces no skip when another computation had already settled the row", async () => {
		const { handler, skipped, published } = createHandler({
			targetLookup: {
				state: "found",
				article: crawledTarget({ crawlStatus: "failed", hasStubMetadata: true }),
			},
			markOutcome: "superseded",
		});

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(skipped).toHaveLength(1);
		expect(published).toEqual([]);
	});

	it("stores an empty result as a completed computation", async () => {
		const { handler, ready, published } = createHandler({
			selectRelatedArticles: async () => ({
				kind: "ready",
				related: [],
				inputTokens: 90,
				outputTokens: 5,
			}),
		});

		await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(ready).toEqual([{ url: TARGET_URL, relatedArticles: [] }]);
		expect(published[0]?.relatedCount).toBe(0);
	});

	it("leaves an already-computed row alone so a re-save never pays for a second call", async () => {
		const { handler, ready, skipped, published } = createHandler({
			existing: { status: "ready", items: [] },
		});

		await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect({ ready, skipped, published }).toEqual({ ready: [], skipped: [], published: [] });
	});

	it("leaves a previously skipped row alone", async () => {
		const { handler, ready, skipped } = createHandler({ existing: { status: "skipped" } });

		await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect({ ready, skipped }).toEqual({ ready: [], skipped: [] });
	});

	it("logs the wait at info while the crawl is still filling in the article's metadata, so a redelivery that is working as designed stays off the errors dashboard, and still retries", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler, ready, skipped } = createHandler({
			targetLookup: { state: "found", article: crawledTarget({ crawlStatus: "pending" }) },
			logger,
		});

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logger.info).toHaveBeenCalledWith(
			"[ComputeRelatedArticles] waiting for crawl metadata; redelivery scheduled",
			{ url: TARGET_URL, messageId: "msg-1" },
		);
		expect(logger.error).not.toHaveBeenCalled();
		expect({ ready, skipped }).toEqual({ ready: [], skipped: [] });
	});

	it("logs the same info wait while the article row has not appeared yet, and still retries", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler } = createHandler({ targetLookup: { state: "absent" }, logger });

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logger.info).toHaveBeenCalledWith(
			"[ComputeRelatedArticles] waiting for crawl metadata; redelivery scheduled",
			{ url: TARGET_URL, messageId: "msg-1" },
		);
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("skips terminally when the article was purged before its related links were computed, so the message never dead-letters", async () => {
		const { handler, skipped, published } = createHandler({
			targetLookup: { state: "purged" },
		});

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(skipped).toEqual([{ url: TARGET_URL, at: NOW }]);
		expect(published).toEqual([
			{
				url: TARGET_URL,
				userId: USER_ID,
				outcome: "skipped",
				relatedCount: 0,
				inputTokens: 0,
				outputTokens: 0,
			},
		]);
	});

	it("skips when the crawl gave up before writing anything to compare", async () => {
		const { handler, skipped, published } = createHandler({
			targetLookup: {
				state: "found",
				article: crawledTarget({ crawlStatus: "failed", hasStubMetadata: true }),
			},
		});

		await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(skipped).toEqual([{ url: TARGET_URL, at: NOW }]);
		expect(published).toEqual([
			{
				url: TARGET_URL,
				userId: USER_ID,
				outcome: "skipped",
				relatedCount: 0,
				inputTokens: 0,
				outputTokens: 0,
			},
		]);
	});

	it("skips while the reader has fewer than fifty other saves, unread and read together", async () => {
		const { handler, skipped, published } = createHandler({
			pools: {
				unreadCandidates: candidates("earlier", 20),
				readCandidates: candidates("finished", 20),
				awaitingCrawl: 0,
			},
		});

		await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(skipped).toEqual([{ url: TARGET_URL, at: NOW }]);
		expect(published[0]?.outcome).toBe("skipped");
	});

	it("proceeds to selection with a full pile even while other saves are still crawling", async () => {
		const { handler, ready, skipped } = createHandler({
			pools: {
				unreadCandidates: candidates("earlier", 60),
				readCandidates: [],
				awaitingCrawl: 15,
			},
		});

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(skipped).toEqual([]);
		expect(ready).toHaveLength(1);
		expect(result).toEqual({ batchItemFailures: [] });
	});

	it("waits instead of skipping when the pile is thin only because a batch of saves is still crawling", async () => {
		const { handler, skipped, published } = createHandler({
			pools: {
				unreadCandidates: candidates("earlier", 20),
				readCandidates: candidates("finished", 20),
				awaitingCrawl: 40,
			},
		});

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(skipped).toEqual([]);
		expect(published).toEqual([]);
		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});

	it("counts past reads toward the comparison floor a thin unread pile cannot reach alone", async () => {
		const pools = {
			unreadCandidates: candidates("earlier", 30),
			readCandidates: candidates("finished", 25),
			awaitingCrawl: 0,
		};
		const { handler, skipped, selected } = createHandler({ pools });

		await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(skipped).toEqual([]);
		expect(selected).toEqual([
			{
				target: crawledTarget(),
				unreadCandidates: pools.unreadCandidates,
				readCandidates: pools.readCandidates,
			},
		]);
	});

	it("retries at error when the model answers with nothing readable, so a genuine failure still reaches the errors dashboard", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler, ready } = createHandler({
			selectRelatedArticles: async () => ({ kind: "no-text-block" }),
			logger,
		});

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(logger.error).toHaveBeenCalledWith(
			"[ComputeRelatedArticles] record failed",
			expect.objectContaining({ messageId: "msg-1" }),
		);
		expect(logger.info).not.toHaveBeenCalled();
		expect(ready).toEqual([]);
	});

	it("skips a save whose text turned out to be a block page shared across sites", async () => {
		const { handler, ready, skipped, published } = createHandler({
			selectRelatedArticles: async () => ({ kind: "shared-boilerplate" }),
		});

		const result = await handler(queueEntryEvent, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(ready).toEqual([]);
		expect(skipped).toHaveLength(1);
		expect(published).toEqual([
			expect.objectContaining({ outcome: "skipped", relatedCount: 0 }),
		]);
	});

	it("retries a message whose payload does not match the command", async () => {
		const { handler } = createHandler();

		const result = await handler(
			createSqsEvent(JSON.stringify({ detail: { url: TARGET_URL } })),
			buildLambdaContext(),
			() => {},
		);

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
	});
});
