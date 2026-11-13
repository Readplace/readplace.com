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

function sqsEvent(params: { body: unknown; messageId?: string; receiveCount?: number; eventId?: string }): SQSEvent {
	return { Records: [{ messageId: params.messageId ?? "physical-message", receiptHandle: "receipt", body: JSON.stringify({ id: params.eventId ?? "eventbridge-event", detail: params.body }), attributes: { ApproximateReceiveCount: String(params.receiveCount ?? 1), SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
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
		fetchYouTubeVideoCard: async () => undefined, fetchRedditPostCard: async () => undefined,
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
	it("forwards the validated detail under its EventBridge event ID as the work ID and acknowledges the record", async () => {
		const dispatchSelectArticleContent = jest.fn(async (_command: SelectArticleContentDetail) => {});
		const handler = forward({ dispatchSelectArticleContent, logger: noopLogger });

		const result = await handler(sqsEvent({ body: detail, messageId: "ingress-message", eventId: "eventbridge-event" }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [] });
		expect(dispatchSelectArticleContent).toHaveBeenCalledTimes(1);
		expect(dispatchSelectArticleContent.mock.calls[0]?.[0]).toEqual({ sourceKind, workId: "eventbridge-event", detail: expect.objectContaining({ url: URL }) });
	});

	it("leaves the ingress record unacknowledged when the forward send fails", async () => {
		const handler = forward({ dispatchSelectArticleContent: async () => { throw new Error("SQS unavailable"); }, logger: noopLogger });

		const result = await handler(sqsEvent({ body: detail, messageId: "ingress-message", eventId: "eventbridge-event" }), buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "ingress-message" }] });
	});

	it("forwards nothing for a body without an EventBridge event ID", async () => {
		const dispatchSelectArticleContent = jest.fn(async () => {});
		const handler = forward({ dispatchSelectArticleContent, logger: noopLogger });
		const event = sqsEvent({ body: detail, messageId: "ingress-message" });
		const [record] = event.Records;
		assert(record);
		record.body = JSON.stringify({ detail });

		const result = await handler(event, buildLambdaContext(), () => {});

		assert.deepEqual(result, { batchItemFailures: [{ itemIdentifier: "ingress-message" }] });
		expect(dispatchSelectArticleContent).not.toHaveBeenCalled();
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

	await handler(sqsEvent({ body: candidateDetail, messageId: "ingress-message", eventId: "eventbridge-event" }), buildLambdaContext(), () => {});

	const input = send.mock.calls[0]?.[0].input;
	assert.equal(input.QueueUrl, "https://sqs.example/select.fifo");
	assert.equal(input.MessageGroupId, articleMessageGroupId({ url: URL }));
	assert.equal(input.MessageDeduplicationId, selectionDeduplicationId({ sourceKind: "recrawl-content-extracted", workId: "eventbridge-event" }));
	assert.deepEqual(JSON.parse(input.MessageBody).detail, { sourceKind: "recrawl-content-extracted", workId: "eventbridge-event", detail: candidateDetail });
});

function capturingForward() {
	const send = jest.fn().mockResolvedValue({});
	const handler = initForwardReselectAfterRemoval({ dispatchSelectArticleContent: initSelectArticleContentDispatch({ sqsClient: { send }, selectArticleContentQueueUrl: "https://sqs.example/select.fifo" }), logger: noopLogger });
	const sentInputs = () => send.mock.calls.map(([command]) => command.input);
	return { handler, sentInputs };
}

it("gives a re-forward of the same EventBridge event under a new ingress message the same deduplication ID", async () => {
	const { handler, sentInputs } = capturingForward();

	await handler(sqsEvent({ body: { url: URL }, messageId: "ingress-message", eventId: "eventbridge-event" }), buildLambdaContext(), () => {});
	await handler(sqsEvent({ body: { url: URL }, messageId: "redriven-message", eventId: "eventbridge-event" }), buildLambdaContext(), () => {});

	const [first, again] = sentInputs();
	assert.equal(again.MessageDeduplicationId, first.MessageDeduplicationId);
});

it("gives two EventBridge events for the same URL with identical bodies different deduplication IDs", async () => {
	const { handler, sentInputs } = capturingForward();

	await handler(sqsEvent({ body: { url: URL }, messageId: "ingress-message", eventId: "first-event" }), buildLambdaContext(), () => {});
	await handler(sqsEvent({ body: { url: URL }, messageId: "ingress-message", eventId: "second-event" }), buildLambdaContext(), () => {});

	const [first, second] = sentInputs();
	assert.notEqual(second.MessageDeduplicationId, first.MessageDeduplicationId);
});

it("gives a reselect forwarded twice from the same EventBridge event the same save attempt, and judges it once", async () => {
	const { handler: forward, sentInputs } = capturingForward();
	await forward(sqsEvent({ body: { url: URL }, messageId: "ingress-message", eventId: "eventbridge-event" }), buildLambdaContext(), () => {});
	await forward(sqsEvent({ body: { url: URL }, messageId: "redriven-message", eventId: "eventbridge-event" }), buildLambdaContext(), () => {});
	const commands = sentInputs().map((input) => JSON.parse(input.MessageBody).detail);
	const { deps, judgeCalls } = selectionDeps();
	const process = initSelectArticleContentHandler(deps);

	const results = [
		await process(sqsEvent({ body: commands[0], messageId: "first-processing-message" }), buildLambdaContext(), () => {}),
		await process(sqsEvent({ body: commands[1], messageId: "second-processing-message" }), buildLambdaContext(), () => {}),
	];

	assert.deepEqual(results, [{ batchItemFailures: [] }, { batchItemFailures: [] }]);
	expect(commands.map((command) => SELECTION_SOURCE_POLICIES["reselect-after-removal"].toRequest(command.detail, command.workId).saveAttemptId)).toEqual(["eventbridge-event", "eventbridge-event"]);
	expect(judgeCalls).toHaveBeenCalledTimes(1);
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

it("derives a reselect's save attempt from the ingress EventBridge event ID, not the processing message ID", () => {
	const request = SELECTION_SOURCE_POLICIES["reselect-after-removal"].toRequest({ url: URL }, "eventbridge-event");

	assert.equal(request.saveAttemptId, "eventbridge-event");
});

it("claims the processing worker's judge for 360 seconds under the physical message ID", async () => {
	const { deps, judgeClaims } = selectionDeps();
	const handler = initSelectArticleContentHandler(deps);

	await handler(sqsEvent({ body: { sourceKind: "tier-content-extracted", workId: "ingress-message", detail: candidateDetail }, messageId: "physical-message" }), buildLambdaContext(), () => {});

	assert.deepEqual(judgeClaims, [{ claimId: "physical-message", claimTtlMs: 360_000 }]);
});

function redeliveryFixture(params: { seededClaimId?: string }) {
	const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW });
	const claimResults: Awaited<ReturnType<typeof ledger.claimMeteredLeg>>[] = [];
	const runMeteredLeg = initRunMeteredLeg({
		...ledger,
		claimMeteredLeg: async (claim) => {
			const result = await ledger.claimMeteredLeg(claim);
			claimResults.push(result);
			return result;
		},
		logger: noopLogger,
		now: () => NOW,
	});
	const lines: { level: string; args: unknown[] }[] = [];
	const record = (level: string) => (...args: unknown[]) => { lines.push({ level, args }); };
	const logger = { info: record("info"), warn: record("warn"), error: record("error"), debug: record("debug") };
	const seed = async () => {
		if (params.seededClaimId === undefined) return;
		await ledger.claimMeteredLeg({ url: URL, leg: "content-judge", inputHash: "first-receive", claimId: params.seededClaimId, expiresAt: new Date(NOW.getTime() + 360_000).toISOString() });
	};
	return { ...selectionDeps({ runMeteredLeg, logger }), claimResults, lines, seed };
}

it("grants a redelivered processing message the judge claim its own timed-out first receive still holds, and judges it without an ownership anomaly", async () => {
	const body = { sourceKind: "tier-content-extracted", workId: "eventbridge-event", detail: candidateDetail };
	const redelivered = redeliveryFixture({ seededClaimId: "physical-message" });
	await redelivered.seed();
	const firstDelivery = redeliveryFixture({});

	const result = await initSelectArticleContentHandler(redelivered.deps)(sqsEvent({ body, messageId: "physical-message", receiveCount: 2 }), buildLambdaContext(), () => {});
	await initSelectArticleContentHandler(firstDelivery.deps)(sqsEvent({ body, messageId: "physical-message", receiveCount: 1 }), buildLambdaContext(), () => {});

	assert.deepEqual(result, { batchItemFailures: [] });
	const [claim] = redelivered.claimResults;
	assert(claim?.kind === "granted");
	assert.equal(claim.permit.claimId, "physical-message");
	expect(redelivered.judgeCalls).toHaveBeenCalledTimes(1);
	assert.deepEqual(redelivered.lines[0]?.args, ["[SelectArticleContent] processing", { sourceKind: "tier-content-extracted", workId: "eventbridge-event", messageId: "physical-message", receiveCount: 2 }]);
	assert.deepEqual(redelivered.lines.filter((line) => line.level === "error"), []);
	const withoutReceiveCount = (lines: typeof redelivered.lines) => JSON.stringify(lines).replaceAll('"receiveCount":2', '"receiveCount":1');
	assert.equal(withoutReceiveCount(redelivered.lines), JSON.stringify(firstDelivery.lines));
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
