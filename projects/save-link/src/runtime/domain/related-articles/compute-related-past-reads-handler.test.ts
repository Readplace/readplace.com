import { articleDestinationUrl } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { ReadlistSlugSchema } from "@packages/domain/readlist";
import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { PublishEvent } from "@packages/hutch-infra-components/runtime";
import type {
	MarkPastReadsReady,
	PastReadsState,
	ReadlistReadCandidate,
	RelatedTargetArticle,
	RelatedTargetLookup,
} from "@packages/provider-contracts/related-articles";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent, SQSRecordAttributes } from "aws-lambda";
import { initComputeRelatedPastReadsHandler } from "./compute-related-past-reads-handler";
import { computePastReadsFingerprint } from "./related-past-reads-fingerprint";
import type { SelectRelatedArticles } from "./related-articles-selector";

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

function sqsEvent(detail: unknown): SQSEvent {
	return {
		Records: [
			{
				messageId: "msg-1",
				receiptHandle: "receipt-1",
				body: JSON.stringify({ "detail-type": "ComputeRelatedPastReads", detail }),
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
	logger?: HutchLogger;
}

function createHandler(overrides: Overrides = {}) {
	const storedTokens: Array<{ inputTokens: number; outputTokens: number }> = [];
	const marked: Array<{
		url: string;
		pastReads: readonly { url: string; reason: string; readlist?: string }[];
		fingerprint: string;
	}> = [];
	const published: Array<{ outcome: string; relatedCount: number }> = [];
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
		selectPastReads:
			overrides.selectPastReads ??
			(async () => ({
				kind: "ready", samples: [], droppedNoSharedWord: 0, droppedReasonNotAboutPick: 0,
				related: [
					{ url: "example.com/a", reason: "Same subject from work" },
					{ url: "example.com/b", reason: "Same subject again" },
				],
				inputTokens: 200,
				outputTokens: 40,
			})),
		markPastReadsReady: async (params) => {
			storedTokens.push({ inputTokens: params.inputTokens, outputTokens: params.outputTokens });
			marked.push({ url: params.url, pastReads: params.pastReads, fingerprint: params.fingerprint });
			return overrides.markOutcome ?? "stored";
		},
		publishEvent,
		now: () => NOW,
		logger: overrides.logger ?? noopLogger,
	});

	return { handler, marked, published, storedTokens };
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
		const { handler, marked } = createHandler({ targetLookup });

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
		expect(marked).toEqual([]);
	});

	it("retries the message when the model returns no text block", async () => {
		const { handler } = createHandler({
			selectPastReads: async () => ({ kind: "no-text-block" }),
		});

		const result = await handler(command, buildLambdaContext(), () => {});

		expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "msg-1" }] });
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
