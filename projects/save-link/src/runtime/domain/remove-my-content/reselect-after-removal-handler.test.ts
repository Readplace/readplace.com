import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { initSelectMostCompleteContent } from "../select-content/select-content";
import { noopLogger } from "@packages/logger";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import type { SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { markCrawlExhausted, promoteTier, type Article, type TransitionAndPersist } from "@packages/domain/article-aggregate";
import { SELECT_CONTENT_MAX_RECEIVE_COUNT } from "../select-content/max-receive-count";
import { candidateProvenance } from "@packages/tier-source";
import { initReselectAfterRemovalHandler } from "./reselect-after-removal-handler";

const cid = (id: string) => CandidateIdSchema.parse(id);

const URL = "https://example.com/post";
const NOW = new Date("2026-10-05T00:00:00.000Z");
const html = "<p>Surviving article</p>";
const source = { tier: "tier-1" as const, html, metadata: candidateProvenance({ metadata: { title: "Article", siteName: "Example", excerpt: "", wordCount: 2, estimatedReadTime: 1 }, html, evaluationHtml: html, attemptId: SaveAttemptIdSchema.parse("survivor"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: NOW.toISOString() }) };
const article: Article = { url: URL, metadata: { title: "Old", siteName: "Example", excerpt: "", wordCount: 2 }, freshness: { contentFetchedAt: NOW.toISOString() }, estimatedReadTime: 1, crawl: { kind: "ready" }, summary: { kind: "skipped" }, summaryAutoHeal: { attempts: 0 }, contentSelection: { candidateId: cid("erased"), tier: "tier-0", revokedCandidateIds: [cid("erased")] } };
function event(detail: unknown, receiveCount = 1): SQSEvent {
	return { Records: [{ messageId: "message", receiptHandle: "receipt", body: JSON.stringify({ detail }), attributes: { ApproximateReceiveCount: String(receiveCount), SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
}
function setup(overrides: Partial<Parameters<typeof initReselectAfterRemovalHandler>[0]> = {}) {
	const savedInputs: unknown[] = [];
	const exhaustedMarks: unknown[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => {
		if (transition === promoteTier) savedInputs.push(params.input);
		if (transition === markCrawlExhausted) exhaustedMarks.push(params);
	};
	const handler = initReselectAfterRemovalHandler({
		listAvailableTierSources: async () => [source], selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog: noopLogger, createChatCompletion: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "winner", candidate: "A", reason: "surviving original", readability: [{ candidate: "A", readable: true }] }) } }] }) }).selectMostCompleteContent,
		runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW }), logger: noopLogger, now: () => NOW }),
		writeCanonicalContent: async () => ({ contentLocation: "s3://content/survivor.html", candidateId: source.metadata.id, tier: source.tier }),
		recordCrawlVersion: async () => {}, readCanonicalContent: async () => undefined, loadArticle: async () => article,
		transitionAndPersist, resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined, now: () => NOW, logger: noopLogger, deepseekCallFailedLog: noopLogger, ...overrides,
	});
	return { handler, savedInputs, exhaustedMarks };
}

describe("content reselection after erasure", () => {
	it("promotes surviving verified content without attributing a new save to the remover", async () => {
		const { handler, savedInputs } = setup();
		expect(await handler(event({ url: URL }), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
		expect(savedInputs[0]).toMatchObject({ tier: "tier-1", metadata: { title: "Article" } });
	});
	it("rejects malformed erasure events before invoking selection", async () => {
		const listAvailableTierSources = jest.fn(async () => [source]);
		const { handler } = setup({ listAvailableTierSources });
		expect(await handler(event({ url: 1 }), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message" }] });
		expect(listAvailableTierSources).not.toHaveBeenCalled();
	});
	it("writes one deepseek-call-failed line naming reselection when the judge's provider fails", async () => {
		const deepseekCallFailed = jest.fn();
		const deepseekCallFailedLog = { ...noopLogger, error: deepseekCallFailed };
		const createChatCompletion = jest.fn(async () => { throw Object.assign(new Error("402 Insufficient Balance"), { status: 402, requestID: null }); });
		const { handler } = setup({
			selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog, createChatCompletion }).selectMostCompleteContent,
			deepseekCallFailedLog,
		});
		expect(await handler(event({ url: URL }), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message" }] });
		expect(createChatCompletion).toHaveBeenCalledTimes(1);
		expect(deepseekCallFailed).toHaveBeenCalledTimes(1);
		expect(deepseekCallFailed.mock.calls[0][0]).toMatchObject({ feature: "reselect-after-removal", status: 402, kind: "http", messageId: "message", receiveCount: 1 });
	});
	it("marks the crawl exhausted on the final receive and still fails the record", async () => {
		const error = jest.fn();
		const { handler, exhaustedMarks } = setup({ selectMostCompleteContent: async () => { throw new Error("S3 unavailable"); }, logger: { ...noopLogger, error } });
		expect(await handler(event({ url: URL }, SELECT_CONTENT_MAX_RECEIVE_COUNT), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message" }] });
		expect(exhaustedMarks).toEqual([{ url: URL, input: { reason: { kind: "exhausted-retries", receiveCount: 3 }, receiveCount: 3 } }]);
		const lines = error.mock.calls.map(([line]) => line).filter((line): line is string => typeof line === "string" && line.startsWith("{")).map((line) => JSON.parse(line));
		expect(lines).toEqual([expect.objectContaining({ message: "[ReselectAfterRemoval] dead-lettered after 3 receives (messageId message); marking crawl exhausted", url: URL })]);
	});
});
