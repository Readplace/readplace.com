import { CandidateIdSchema, SaveAttemptIdSchema } from "@packages/domain/article";
import { initSelectMostCompleteContent } from "../select-content/select-content";
import { noopLogger } from "@packages/hutch-logger";
import type { SQSEvent } from "aws-lambda";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { promoteTier, type Article, type TransitionAndPersist } from "@packages/domain/article-aggregate";
import { candidateProvenance } from "../select-content/candidate-provenance";
import { initReselectAfterRemovalHandler } from "./reselect-after-removal-handler";

const cid = (id: string) => CandidateIdSchema.parse(id);

const URL = "https://example.com/post";
const NOW = new Date("2026-10-05T00:00:00.000Z");
const html = "<p>Surviving article</p>";
const source = { tier: "tier-1" as const, html, metadata: candidateProvenance({ metadata: { title: "Article", siteName: "Example", excerpt: "", wordCount: 2, estimatedReadTime: 1 }, html, evaluationHtml: html, attemptId: SaveAttemptIdSchema.parse("survivor"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: NOW.toISOString() }) };
const article: Article = { url: URL, metadata: { title: "Old", siteName: "Example", excerpt: "", wordCount: 2 }, freshness: { contentFetchedAt: NOW.toISOString() }, estimatedReadTime: 1, crawl: { kind: "ready" }, summary: { kind: "skipped" }, summaryAutoHeal: { attempts: 0 }, contentSelection: { candidateId: cid("erased"), tier: "tier-0", revokedCandidateIds: [cid("erased")] } };
function event(detail: unknown): SQSEvent {
	return { Records: [{ messageId: "message", receiptHandle: "receipt", body: JSON.stringify({ detail }), attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
}
function setup(overrides: Partial<Parameters<typeof initReselectAfterRemovalHandler>[0]> = {}) {
	const savedInputs: unknown[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => {
		if (transition === promoteTier) savedInputs.push(params.input);
	};
	const handler = initReselectAfterRemovalHandler({
		listAvailableTierSources: async () => [source], selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, createChatCompletion: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "winner", candidateId: source.metadata.id, reason: "surviving original", readability: [{ candidateId: source.metadata.id, readable: true }] }) } }] }) }).selectMostCompleteContent,
		writeCanonicalContent: async () => ({ contentLocation: "s3://content/survivor.html", candidateId: source.metadata.id, originalUrl: URL, tier: source.tier }),
		recordCrawlVersion: async () => {}, readCanonicalContent: async () => undefined, loadArticle: async () => article,
		transitionAndPersist, resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined, now: () => NOW, logger: noopLogger, ...overrides,
	});
	return { handler, savedInputs };
}

describe("content reselection after erasure", () => {
	it("promotes surviving verified content without attributing a new save to the remover", async () => {
		const { handler, savedInputs } = setup();
		expect(await handler(event({ url: URL }), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
		expect(savedInputs[0]).toMatchObject({ tier: "tier-1", userId: undefined, metadata: { title: "Article" } });
	});
	it("rejects malformed erasure events before invoking selection", async () => {
		const listAvailableTierSources = jest.fn(async () => [source]);
		const { handler } = setup({ listAvailableTierSources });
		expect(await handler(event({ url: 1 }), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message" }] });
		expect(listAvailableTierSources).not.toHaveBeenCalled();
	});
});
