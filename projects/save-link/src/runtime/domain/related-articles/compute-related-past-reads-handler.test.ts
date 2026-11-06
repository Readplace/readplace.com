import assert from "node:assert/strict";
import { articleDestinationUrl } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import type { DeepseekCallFailedLogLine } from "@packages/ai-message";
import { type Logger, noopLogger } from "@packages/logger";
import type { PublishEvent } from "@packages/infra-components/runtime";
import type {
	MarkPastReadsBudgetBlocked,
	MarkPastReadsReady,
	PastReadsState,
	ReadlistReadCandidate,
	RelatedTargetArticle,
	RelatedTargetLookup,
} from "@packages/provider-contracts/related-articles";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT } from "./max-receive-count";
import { initComputeRelatedPastReadsHandler } from "./compute-related-past-reads-handler";
import { computePastReadsFingerprint } from "./related-past-reads-fingerprint";
import { ComputeRelatedPassesCommand, ComputeRelatedPastReadsCommand, QueueEntryCreatedEvent } from "./index";
import type { SelectRelatedArticles, SelectRelatedArticlesParams } from "./related-articles-selector";

const USER_ID = UserIdSchema.parse("00000000000000000000000000000001");
const WORK = ReadlistSlugSchema.parse("work");
const TARGET_URL = "https://example.com/target";
const NOW = new Date("2026-09-12T10:00:00.000Z");

const stubAttributes: SQSRecordAttributes = {
	ApproximateReceiveCount: "1",
	SentTimestamp: "1620000000000",
	SenderId: "TESTID",
	ApproximateFirstReceiveTimestamp: "1620000000001",
};

function sqsEvent(detail: unknown, detailType = "ComputeRelatedPastReads"): SQSEvent {
	return {
		Records: [
			{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ "detail-type": detailType, detail }),
				attributes: stubAttributes,
				messageAttributes: {},
				md5OfBody: "",
				eventSource: "aws:sqs",
				eventSourceARN: "arn:aws:sqs:ap-southeast-2:123456789:ComputeRelatedPastReads",
				awsRegion: "ap-southeast-2",
			},
		],
	};
}

const command = sqsEvent({ url: TARGET_URL, userId: USER_ID, readlist: "work" });

function crawledTarget(overrides: Partial<RelatedTargetArticle> = {}): RelatedTargetArticle {
	return {
		destinationUrl: articleDestinationUrl({ url: "https://example.com/target", displayUrl: undefined }),
		hasSummary: false,
		crawlStatus: "ready",
		title: "The target",
		siteName: "Example",
		description: "An excerpt",
		hasStubMetadata: false,
		...overrides,
	};
}

const CANDIDATES: ReadlistReadCandidate[] = [
	{ destinationUrl: articleDestinationUrl({ url: "example.com/a", displayUrl: undefined }), url: "example.com/a", title: "A", siteName: "Example", description: "About A", readlist: WORK },
	{ destinationUrl: articleDestinationUrl({ url: "example.com/b", displayUrl: undefined }), url: "example.com/b", title: "B", siteName: "Example", description: "About B" },
];

function fingerprintFor(candidateUrls: readonly string[]): string {
	return computePastReadsFingerprint({
		target: { destinationUrl: articleDestinationUrl({ url: TARGET_URL, displayUrl: undefined }), url: TARGET_URL, title: "The target", siteName: "Example", description: "An excerpt" },
		candidateUrls,
	});
}

interface Overrides {
	targetLookup?: RelatedTargetLookup;
	candidates?: readonly ReadlistReadCandidate[];
	state?: PastReadsState;
	selectPastReads?: SelectRelatedArticles;
	markOutcome?: Awaited<ReturnType<MarkPastReadsReady>>;
	blockedOutcome?: Awaited<ReturnType<MarkPastReadsBudgetBlocked>>;
	logger?: Logger;
	deepseekCallFailedLog?: Logger.Typed<DeepseekCallFailedLogLine>;
}

function createHandler(overrides: Overrides = {}) {
	const storedTokens: Array<{ inputTokens: number; outputTokens: number }> = [];
	const marked: Array<{
		url: string;
		pastReads: readonly { url: string; reason: string; readlist?: string }[];
		fingerprint: string;
	}> = [];
	const published: Array<{ outcome: string; relatedCount: number }> = [];
	const selected: SelectRelatedArticlesParams[] = [];
	const blocked: Parameters<MarkPastReadsBudgetBlocked>[0][] = [];
	const publishEvent: PublishEvent = async (_event, detail) => {
		const parsed = detail as { outcome: string; relatedCount: number };
		published.push({ outcome: parsed.outcome, relatedCount: parsed.relatedCount });
	};

	const handler = initComputeRelatedPastReadsHandler({
		findRelatedTargetArticle: async () =>
			overrides.targetLookup ?? { state: "found", article: crawledTarget() },
		findReadCandidatesAcrossReadlists: async () => ({
			candidates: overrides.candidates ?? CANDIDATES,
			awaitingCrawl: 0,
		}),
		readPastReadsState: async () => overrides.state ?? {},
		selectPastReads: async (params) => {
			selected.push(params);
			return overrides.selectPastReads ? overrides.selectPastReads(params) : {
				kind: "ready", samples: [], droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0,
				related: [
					{ url: "example.com/a", reason: "Same subject from work" },
					{ url: "example.com/b", reason: "Same subject again" },
				],
				inputTokens: 200,
				outputTokens: 40,
			};
		},
		markPastReadsReady: async (params) => {
			storedTokens.push({ inputTokens: params.inputTokens, outputTokens: params.outputTokens });
			marked.push({ url: params.url, pastReads: params.pastReads, fingerprint: params.fingerprint });
			return overrides.markOutcome ?? "stored";
		},
		markPastReadsBudgetBlocked: async (params) => {
			blocked.push(params);
			return overrides.blockedOutcome ?? "stored";
		},
		publishEvent,
		now: () => NOW,
		logger: overrides.logger ?? noopLogger,
		deepseekCallFailedLog: overrides.deepseekCallFailedLog ?? noopLogger,
	});

	return { handler, marked, published, storedTokens, selected, blocked };
}

describe("initComputeRelatedPastReadsHandler", () => {
	it("stores the lexical skip with its fingerprint, zero tokens, ready event and zero drop counts", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler, marked, published, storedTokens } = createHandler({
			logger,
			selectPastReads: async () => ({ kind: "no-shared-words", bestScore: 7.98, candidateCount: 2 }),
		});
		expect(await handler(command, buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
		expect(marked).toEqual([{ url: TARGET_URL, pastReads: [], fingerprint: fingerprintFor(["example.com/a", "example.com/b"]) }]);
		expect(storedTokens).toEqual([{ inputTokens: 0, outputTokens: 0 }]);
		expect(published).toEqual([{ outcome: "ready", relatedCount: 0 }]);
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] no earlier read shares the article's words", { url: TARGET_URL, bestScore: 7.98, candidateCount: 2 });
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] completed", { sampleCount: 0, samples: [], url: TARGET_URL, relatedCount: 0, droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0 });
	});

	it("logs the selector's disjoint drop counts on completion", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler } = createHandler({ logger, selectPastReads: async () => ({ kind: "ready", samples: [], related: [], inputTokens: 200, outputTokens: 40, droppedNoSharedWord: 2, droppedReasonNotAboutPick: 1 }) });
		await handler(command, buildLambdaContext(), () => {});
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] completed", { sampleCount: 0, samples: [], url: TARGET_URL, relatedCount: 0, droppedNoSharedWord: 2, droppedReasonNotAboutPick: 1 });
	});

	it.each(["stub", "shared-boilerplate"])("logs zero drops when %s makes no model call", async (kind) => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler, storedTokens } = createHandler({
			logger,
			targetLookup: { state: "found", article: crawledTarget({ hasStubMetadata: kind === "stub" }) },
			selectPastReads: async () => ({ kind: "shared-boilerplate" }),
		});
		await handler(command, buildLambdaContext(), () => {});
		expect(storedTokens).toEqual([{ inputTokens: 0, outputTokens: 0 }]);
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] completed", { sampleCount: 0, samples: [], url: TARGET_URL, relatedCount: 0, droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0 });
	});
	it("stores the selected past reads with their reading-list context and announces the outcome", async () => {
		const { handler, marked, published } = createHandler();

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(marked).toEqual([
			{
				url: TARGET_URL,
				pastReads: [
					{ url: "example.com/a", reason: "Same subject from work", readlist: WORK },
					{ url: "example.com/b", reason: "Same subject again" },
				],
				fingerprint: fingerprintFor(["example.com/a", "example.com/b"]),
			},
		]);
		expect(published).toEqual([{ outcome: "ready", relatedCount: 2 }]);
	});

	it("reuses the cache and recomputes nothing when the inputs are unchanged", async () => {
		const { handler, marked, published } = createHandler({
			state: { fingerprint: fingerprintFor(["example.com/a", "example.com/b"]), computedAt: NOW },
		});

		await handler(command, buildLambdaContext(), () => {});

		expect(marked).toEqual([]);
		expect(published).toEqual([{ outcome: "unchanged", relatedCount: 0 }]);
	});

	it("caches an empty result when the article's own text is a shared block page", async () => {
		const { handler, marked, published } = createHandler({
			selectPastReads: async () => ({ kind: "shared-boilerplate" }),
		});

		await handler(command, buildLambdaContext(), () => {});

		expect(marked[0]?.pastReads).toEqual([]);
		expect(published).toEqual([{ outcome: "ready", relatedCount: 0 }]);
	});

	it("caches an empty result without calling the model when the article has only stub metadata", async () => {
		let modelCalled = false;
		const { handler, marked } = createHandler({
			targetLookup: { state: "found", article: crawledTarget({ hasStubMetadata: true }) },
			selectPastReads: async () => {
				modelCalled = true;
				return { kind: "ready", samples: [], droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0, related: [], inputTokens: 0, outputTokens: 0 };
			},
		});

		await handler(command, buildLambdaContext(), () => {});

		expect(modelCalled).toBe(false);
		expect(marked[0]?.pastReads).toEqual([]);
	});

	it("skips a purged article without writing or announcing anything", async () => {
		const { handler, marked, published } = createHandler({
			targetLookup: { state: "purged" },
		});

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(marked).toEqual([]);
		expect(published).toEqual([]);
	});

	it("leaves a webmail page alone without asking for a selection", async () => {
		let selectionCalled = false;
		const { handler, marked, published } = createHandler({
			targetLookup: { state: "not-an-article" },
			selectPastReads: async () => {
				selectionCalled = true;
				return { kind: "shared-boilerplate" };
			},
		});

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(selectionCalled).toBe(false);
		expect(marked).toEqual([]);
		expect(published).toEqual([]);
	});

	it.each([
		["absent", { state: "absent" } as RelatedTargetLookup],
		["still crawling", { state: "found", article: crawledTarget({ crawlStatus: "pending" }) } as RelatedTargetLookup],
	])("retries the message while the article metadata is %s", async (_label, targetLookup) => {
		const deepseekCallFailed = jest.fn();
		const { handler, marked } = createHandler({
			targetLookup,
			deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed },
		});

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(marked).toEqual([]);
		expect(deepseekCallFailed).not.toHaveBeenCalled();
	});

	it("gives up without a retry when the crawl is still pending on the final receive", async () => {
		const { handler, marked, published } = createHandler({
			targetLookup: { state: "found", article: crawledTarget({ crawlStatus: "pending" }) },
		});
		const [record] = command.Records;
		assert(record, "the command holds one record");
		const finalReceive: SQSEvent = {
			Records: [
				{
					...record,
					attributes: {
						...stubAttributes,
						ApproximateReceiveCount: String(COMPUTE_RELATED_ARTICLES_MAX_RECEIVE_COUNT),
					},
				},
			],
		};

		const result = await handler(finalReceive, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(marked).toEqual([]);
		expect(published).toEqual([]);
	});

	it("retries the message when the model returns no text block", async () => {
		const deepseekCallFailed = jest.fn();
		const { handler } = createHandler({
			selectPastReads: async () => ({ kind: "no-text-block" }),
			deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed },
		});

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deepseekCallFailed).not.toHaveBeenCalled();
	});

	it("writes one deepseek-call-failed line for a provider error and still fails the record", async () => {
		const deepseekCallFailed = jest.fn();
		const providerError = Object.assign(new Error("402 Insufficient Balance"), { status: 402, requestID: null });
		const { handler } = createHandler({
			selectPastReads: async () => {
				throw providerError;
			},
			deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed },
		});

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(deepseekCallFailed).toHaveBeenCalledTimes(1);
		const line = deepseekCallFailed.mock.calls[0][0];
		expect(line).toMatchObject({ feature: "compute-related-past-reads", status: 402, kind: "http", receiveCount: 1, messageId: "msg-1" });
		expect(line).not.toHaveProperty("url");
	});

	it("announces nothing when a newer computation already settled the row", async () => {
		const { handler, published } = createHandler({ markOutcome: "superseded" });

		await handler(command, buildLambdaContext(), () => {});

		expect(published).toEqual([]);
	});
});


it("logs the single Already-read sample with its cache split and duration", async () => {
	const logger = { ...noopLogger, info: jest.fn() };
	const samples = [{ inputTokens: 200, outputTokens: 40, cacheHitInputTokens: 150, cacheMissInputTokens: 50, durationMs: 30 }];
	const { handler, storedTokens } = createHandler({ logger, selectPastReads: async () => ({ kind: "ready", related: [], inputTokens: 200, outputTokens: 40, droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0, samples }) });
	await handler(command, buildLambdaContext(), () => {});
	expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] completed", expect.objectContaining({ sampleCount: 1, samples }));
	expect(storedTokens).toEqual([{ inputTokens: 200, outputTokens: 40 }]);
});

describe("initComputeRelatedPastReadsHandler daily budget", () => {
	const resetsAt = new Date("2026-09-13T00:00:00.000Z");
	const savedAt = new Date("2026-09-12T09:00:00.000Z");
	const computedAt = new Date("2026-09-12T09:30:00.000Z");
	const budgetLimited: SelectRelatedArticles = async () => ({ kind: "budget-limited", resetsAt });

	it.each([
		{ detailType: QueueEntryCreatedEvent.detailType, trigger: "save" },
		{ detailType: ComputeRelatedPassesCommand.detailType, trigger: "reader-request" },
		{ detailType: ComputeRelatedPastReadsCommand.detailType, trigger: "reader-request" },
	])("hands the selector the $trigger attempt for a $detailType message", async ({ detailType, trigger }) => {
		const { handler, selected } = createHandler();

		await handler(sqsEvent({ url: TARGET_URL, userId: USER_ID }, detailType), buildLambdaContext(), () => {});

		expect(selected.map((params) => params.attempt)).toEqual([
			{ userId: USER_ID, trigger, messageId: "msg-1", receiveCount: 1 },
		]);
	});

	it("retries a message whose detail-type names no past-reads request", async () => {
		const { handler, selected } = createHandler();

		const result = await handler(sqsEvent({ url: TARGET_URL, userId: USER_ID }, "SomethingElse"), buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(selected).toEqual([]);
	});

	it.each([
		{ state: { savedAt }, observed: { savedAt } },
		{ state: { savedAt, computedAt, fingerprint: "older" }, observed: { savedAt, computedAt } },
	])("marks the row blocked until the reset against the state it read, observing $observed", async ({ state, observed }) => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler, blocked, marked, published } = createHandler({ logger, state, selectPastReads: budgetLimited });

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(blocked).toEqual([{ userId: USER_ID, url: TARGET_URL, blockedUntil: resetsAt, observed }]);
		expect({ marked, published }).toEqual({ marked: [], published: [] });
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] budget-limited", {
			url: TARGET_URL,
			resetsAt,
			receiveCount: 1,
		});
	});

	it("logs superseded when the row changed after it was read", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler, blocked, marked, published } = createHandler({
			logger,
			state: { savedAt },
			selectPastReads: budgetLimited,
			blockedOutcome: "superseded",
		});

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect(blocked).toHaveLength(1);
		expect({ marked, published }).toEqual({ marked: [], published: [] });
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] superseded", { url: TARGET_URL });
	});

	it("treats a row without a save time as superseded and writes nothing", async () => {
		const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		const { handler, blocked, marked, published } = createHandler({ logger, state: {}, selectPastReads: budgetLimited });

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [] });
		expect({ blocked, marked, published }).toEqual({ blocked: [], marked: [], published: [] });
		expect(logger.info).toHaveBeenCalledWith("[ComputeRelatedPastReads] superseded", { url: TARGET_URL });
	});
});
