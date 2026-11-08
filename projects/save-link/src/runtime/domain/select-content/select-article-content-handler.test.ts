import assert from "node:assert/strict";
import type { SQSEvent } from "aws-lambda";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/logger";
import { type Article, SelectionSnapshotChangedError, type TransitionAndPersist, markCrawlExhausted, promoteTier, recrawlPromoteTier, refreshContent } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { candidateProvenance, type VerifiedTierSource } from "@packages/tier-source";
import type { SelectArticleContentDetail } from "@packages/infra-components";
import { initRunMeteredLeg, type RunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initSelectMostCompleteContent } from "./select-content";
import { initSelectArticleContentHandler } from "./select-article-content-handler";
import { initForwardTierContentExtracted, initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { initForwardRecrawlContentExtracted } from "./recrawl-content-extracted-handler";
import { initForwardRefreshContentExtracted } from "./refresh-content-extracted-handler";
import { initForwardReselectAfterRemoval } from "../remove-my-content/reselect-after-removal-handler";
import { SELECTION_SOURCE_POLICIES } from "./selection-source-policies";
import { initSelectArticleContentDispatch, selectionDeduplicationId } from "../../dep-bundles/select-article-content-dispatch";
import { articleMessageGroupId } from "../../dep-bundles/generate-summary-dispatch";

const URL = "https://example.com/article";
const NOW = new Date("2026-10-05T00:00:00.000Z");
const source: VerifiedTierSource = { tier: "tier-1", html: "<p>Real article content</p>", metadata: candidateProvenance({ metadata: { title: "Real title", siteName: "Example", excerpt: "Article excerpt", wordCount: 99, estimatedReadTime: 1 }, html: "<p>Real article content</p>", evaluationHtml: "<p>Real article content</p>", attemptId: SaveAttemptIdSchema.parse("save-attempt"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: NOW.toISOString() }) };
const article: Article = { url: URL, metadata: { title: "Old", siteName: "Example", excerpt: "Old excerpt", wordCount: 3 }, freshness: { contentFetchedAt: NOW.toISOString() }, estimatedReadTime: 1, crawl: { kind: "pending", pendingSince: NOW.toISOString() }, summary: { kind: "pending", pendingSince: NOW.toISOString() }, summaryAutoHeal: { attempts: 0 } };
const candidateDetail = { url: URL, saveAttemptId: "save-attempt", candidates: [{ id: source.metadata.id, tier: source.tier }] };
const refreshDetail = { ...candidateDetail, contentFetchedAt: "2026-10-05T00:00:00.000Z", bodyHash: "raw-hash", etag: "current-etag" };

function sqsEvent(params: { body: unknown; messageId?: string; receiveCount?: number }): SQSEvent {
	return { Records: [{ messageId: params.messageId ?? "physical-message", receiptHandle: "receipt", body: JSON.stringify({ detail: params.body }), attributes: { ApproximateReceiveCount: String(params.receiveCount ?? 1), SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
}

function selectionDeps(overrides: Partial<Parameters<typeof initSelectArticleContentHandler>[0]> = {}) {
	const persisted: { transition: unknown; input: unknown }[] = [];
	const judgeClaims: { claimId: string; claimTtlMs: number }[] = [];
	const judgeCalls = jest.fn(async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "winner", candidate: "A", reason: "readable article", readability: [{ candidate: "A", readable: true }] }) } }] }));
	const runMeteredLeg = initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW }), logger: noopLogger, now: () => NOW });
	const spiedMeteredLeg: RunMeteredLeg = async (params) => { judgeClaims.push({ claimId: params.claimId, claimTtlMs: params.claimTtlMs }); return runMeteredLeg(params); };
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => { persisted.push({ transition, input: params.input }); };
	const info = jest.fn();
	const deps = {
		listAvailableTierSources: async () => [source],
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog: noopLogger, createChatCompletion: judgeCalls }).selectMostCompleteContent,
		runMeteredLeg: spiedMeteredLeg,
		writeCanonicalContent: async () => ({ contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, tier: source.tier }),
		recordCrawlVersion: async () => {},
		readCanonicalContent: async () => undefined,
		loadArticle: async () => article,
		transitionAndPersist,
		resolveOriginalUrl: async () => URL,
		verifyWrapperSource: async () => undefined,
		fetchYouTubeVideoCard: async () => undefined,
		putTierSource: async (params: { metadata: VerifiedTierSource["metadata"] }) => params.metadata,
		now: () => NOW,
		logger: { ...noopLogger, info },
		deepseekCallFailedLog: noopLogger,
		...overrides,
	};
	return { deps, persisted, judgeClaims, judgeCalls, info };
}

const KINDS = [
	{ sourceKind: "tier-content-extracted", forward: initForwardTierContentExtracted, detail: { ...candidateDetail, userId: "user-1" }, transition: promoteTier, exhausts: true },
	{ sourceKind: "recrawl-content-extracted", forward: initForwardRecrawlContentExtracted, detail: candidateDetail, transition: recrawlPromoteTier, exhausts: true },
	{ sourceKind: "refresh-content-extracted", forward: initForwardRefreshContentExtracted, detail: refreshDetail, transition: refreshContent, exhausts: false },
	{ sourceKind: "reselect-after-removal", forward: initForwardReselectAfterRemoval, detail: { url: URL }, transition: promoteTier, exhausts: true },
] as const;

describe.each(KINDS)("$sourceKind ingress in forward mode", ({ sourceKind, forward, detail }) => {
	it("forwards the validated detail under the ingress message as its work ID and acknowledges the record", async () => {
		const dispatchSelectArticleContent = jest.fn(async (_command: SelectArticleContentDetail) => {});
		const handler = forward({ dispatchSelectArticleContent, logger: noopLogger });

		const result = await handler(sqsEvent({ body: detail, messageId: "ingress-message" }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		expect(dispatchSelectArticleContent).toHaveBeenCalledTimes(1);
		expect(dispatchSelectArticleContent.mock.calls[0]?.[0]).toEqual({ sourceKind, workId: "ingress-message", detail: expect.objectContaining({ url: URL }) });
	});

	it("leaves the ingress record unacknowledged when the forward send fails", async () => {
		const handler = forward({ dispatchSelectArticleContent: async () => { throw new Error("SQS unavailable"); }, logger: noopLogger });

		const result = await handler(sqsEvent({ body: detail, messageId: "ingress-message" }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "ingress-message" }] });
	});

	it("forwards nothing for a body its kind's schema refuses", async () => {
		const dispatchSelectArticleContent = jest.fn(async () => {});
		const handler = forward({ dispatchSelectArticleContent, logger: noopLogger });

		const result = await handler(sqsEvent({ body: { url: 123 }, messageId: "ingress-message" }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "ingress-message" }] });
		expect(dispatchSelectArticleContent).not.toHaveBeenCalled();
	});
});

it("sends a forwarded record to the FIFO queue grouped by article identity and deduplicated by kind and work ID", async () => {
	const send = jest.fn().mockResolvedValue({});
	const handler = initForwardRecrawlContentExtracted({ dispatchSelectArticleContent: initSelectArticleContentDispatch({ sqsClient: { send }, selectArticleContentQueueUrl: "https://sqs.example/select.fifo" }), logger: noopLogger });

	await handler(sqsEvent({ body: candidateDetail, messageId: "ingress-message" }), buildLambdaContext(), () => {});

	const input = send.mock.calls[0]?.[0].input;
	assert.equal(input.QueueUrl, "https://sqs.example/select.fifo");
	assert.equal(input.MessageGroupId, articleMessageGroupId({ url: URL }));
	assert.equal(input.MessageDeduplicationId, selectionDeduplicationId({ sourceKind: "recrawl-content-extracted", workId: "ingress-message" }));
	assert.deepEqual(JSON.parse(input.MessageBody).detail, { sourceKind: "recrawl-content-extracted", workId: "ingress-message", detail: candidateDetail });
});

describe.each(KINDS)("$sourceKind processing", ({ sourceKind, detail, transition, exhausts }) => {
	it("runs the kind's own selection policy and commits its transition", async () => {
		const { deps, persisted, judgeCalls } = selectionDeps();
		const handler = initSelectArticleContentHandler(deps);

		const result = await handler(sqsEvent({ body: { sourceKind, workId: "ingress-message", detail } }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		expect(judgeCalls).toHaveBeenCalledTimes(1);
		expect(persisted.map((entry) => entry.transition)).toEqual([transition]);
	});

	it(`${exhausts ? "marks the crawl exhausted" : "keeps the row"} when the final receive fails`, async () => {
		const { deps, persisted } = selectionDeps({ listAvailableTierSources: async () => { throw new Error("S3 unavailable"); } });
		const handler = initSelectArticleContentHandler(deps);

		const result = await handler(sqsEvent({ body: { sourceKind, workId: "ingress-message", detail }, receiveCount: 3 }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "physical-message" }] });
		expect(persisted.map((entry) => entry.transition)).toEqual(exhausts ? [markCrawlExhausted] : []);
	});
});

it("logs each processing record with its source kind, work ID, physical message ID and receive count", async () => {
	const { deps, info } = selectionDeps();
	const handler = initSelectArticleContentHandler(deps);

	await handler(sqsEvent({ body: { sourceKind: "reselect-after-removal", workId: "ingress-message", detail: { url: URL } }, messageId: "physical-message", receiveCount: 2 }), buildLambdaContext(), () => {});

	expect(info).toHaveBeenCalledWith("[SelectArticleContent] processing", { sourceKind: "reselect-after-removal", workId: "ingress-message", messageId: "physical-message", receiveCount: 2 });
});

it("fails a processing record whose command does not decode, without selecting", async () => {
	const { deps, persisted, judgeCalls } = selectionDeps();
	const handler = initSelectArticleContentHandler(deps);

	const result = await handler(sqsEvent({ body: { sourceKind: "unknown-kind", workId: "ingress-message", detail: { url: URL } }, receiveCount: 3 }), buildLambdaContext(), () => {});

	assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "physical-message" }] });
	expect(judgeCalls).not.toHaveBeenCalled();
	assert.deepEqual(persisted, []);
});

it("derives a reselect's save attempt from the ingress work ID, not the processing message ID", () => {
	const request = SELECTION_SOURCE_POLICIES["reselect-after-removal"].toRequest({ url: URL }, "ingress-message");

	assert.equal(request.saveAttemptId, "ingress-message");
});

it("claims the processing worker's judge for 360 seconds under the physical message ID", async () => {
	const { deps, judgeClaims } = selectionDeps();
	const handler = initSelectArticleContentHandler(deps);

	await handler(sqsEvent({ body: { sourceKind: "tier-content-extracted", workId: "ingress-message", detail: candidateDetail }, messageId: "physical-message" }), buildLambdaContext(), () => {});

	assert.deepEqual(judgeClaims, [{ claimId: "physical-message", claimTtlMs: 360_000 }]);
});

it("keeps the legacy selection handler's judge claim at its queue visibility", async () => {
	const { deps, judgeClaims } = selectionDeps();
	const handler = initSelectMostCompleteContentHandler(deps);

	await handler(sqsEvent({ body: candidateDetail, messageId: "legacy-message" }), buildLambdaContext(), () => {});

	assert.deepEqual(judgeClaims, [{ claimId: "legacy-message", claimTtlMs: 300_000 }]);
});

it("fails a processing record whose judge claim another owner holds as an ownership anomaly, without marking the crawl on its final receive", async () => {
	const error = jest.fn();
	const { deps, persisted, judgeCalls } = selectionDeps({ runMeteredLeg: async () => ({ kind: "in-flight" }), logger: { ...noopLogger, error } });
	const handler = initSelectArticleContentHandler(deps);

	const result = await handler(sqsEvent({ body: { sourceKind: "recrawl-content-extracted", workId: "ingress-message", detail: candidateDetail }, messageId: "physical-message", receiveCount: 3 }), buildLambdaContext(), () => {});

	assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "physical-message" }] });
	assert.deepEqual(persisted, []);
	expect(judgeCalls).not.toHaveBeenCalled();
	expect(error).toHaveBeenCalledTimes(1);
	expect(error).toHaveBeenCalledWith("[RecrawlContentExtracted] ownership anomaly: another owner holds the content judge", {
		sourceKind: "recrawl-content-extracted",
		workId: "ingress-message",
		messageId: "physical-message",
		receiveCount: 3,
		url: URL,
		claimTtlMs: 360_000,
	});
});

it("keeps failing a legacy record whose judge claim another delivery holds and marks the crawl exhausted on its final receive", async () => {
	const { deps, persisted } = selectionDeps({ runMeteredLeg: async () => ({ kind: "in-flight" }) });
	const handler = initSelectMostCompleteContentHandler(deps);

	const result = await handler(sqsEvent({ body: candidateDetail, messageId: "legacy-message", receiveCount: 3 }), buildLambdaContext(), () => {});

	assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "legacy-message" }] });
	expect(persisted.map((entry) => entry.transition)).toEqual([markCrawlExhausted]);
});

it("re-decides a processing record whose selection snapshot changed before its commit, reusing the settled verdict", async () => {
	let commits = 0;
	const { deps, persisted, judgeCalls, info } = selectionDeps({
		transitionAndPersist: async (transition, params) => {
			commits += 1;
			if (commits === 1) throw new SelectionSnapshotChangedError("selection-changed");
			persisted.push({ transition, input: params.input });
		},
	});
	const handler = initSelectArticleContentHandler(deps);

	const result = await handler(sqsEvent({ body: { sourceKind: "tier-content-extracted", workId: "ingress-message", detail: candidateDetail } }), buildLambdaContext(), () => {});

	assert.deepEqual(result, { batchItemFailures: [] });
	expect(judgeCalls).toHaveBeenCalledTimes(1);
	expect(persisted.map((entry) => entry.transition)).toEqual([promoteTier]);
	expect(info).toHaveBeenCalledWith("[SelectContent] recovered a changed selection snapshot", expect.objectContaining({ conflicts: ["selection-changed"], attempts: 2 }));
});
