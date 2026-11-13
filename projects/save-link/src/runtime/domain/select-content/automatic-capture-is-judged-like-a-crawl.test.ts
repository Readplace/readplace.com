import { type CaptureTrigger, type SaveAttemptId, SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/logger";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { type Article, type TransitionAndPersist, markCrawlAwaitingReader, promoteTier } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent } from "aws-lambda";
import type { CreateDeepseekChatCompletion } from "@packages/ai-message";
import { initSelectMostCompleteContent } from "./select-content";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { candidateProvenance, type VerifiedTierSource } from "@packages/tier-source";
import { labelForIndex } from "./select-content-prompt";
import { markNoReadableArticle } from "./mark-no-readable-article";
import { COMPARISON_COMPLETED } from "./comparison-log";
import type { PreparedContentSelection } from "./prepare-content-selection";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const URL = "https://example.com/article";
const NOW = "2026-10-13T00:00:00.000Z";
const RESCUE = SaveAttemptIdSchema.parse("automatic-rescue");
const FAILED_CRAWL = SaveAttemptIdSchema.parse("failed-crawl");
const EARLIER_SAVE = SaveAttemptIdSchema.parse("earlier-save");

function candidate(params: { tier: "tier-0" | "tier-1"; attemptId: SaveAttemptId; html: string; wordCount: number; httpStatus?: number; captureTrigger?: CaptureTrigger }): VerifiedTierSource {
	return {
		tier: params.tier, html: params.html,
		metadata: candidateProvenance({
			metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: params.wordCount, estimatedReadTime: 1 },
			html: params.html, evaluationHtml: params.html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: URL,
			kind: params.tier === "tier-0" ? "extension" : "live", fetchedAt: NOW, httpStatus: params.httpStatus, captureTrigger: params.captureTrigger,
		}),
	};
}

function automaticCapture(): VerifiedTierSource {
	return candidate({ tier: "tier-0", attemptId: RESCUE, captureTrigger: "automatic", wordCount: 9, html: "<article><h1>Article</h1><p>The page the reader's device loaded on its own.</p></article>" });
}

function committedCanonical(): VerifiedTierSource {
	return candidate({ tier: "tier-1", attemptId: EARLIER_SAVE, wordCount: 9, html: "<article><h1>Article</h1><p>The article as an earlier save committed it.</p></article>" });
}

function failedArticle(): Article {
	return {
		url: URL, metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: 0 }, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 1,
		crawl: { kind: "failed", reason: { kind: "blocked", cause: "edge-block" } }, summary: { kind: "skipped", reason: "crawl-failed" }, summaryAutoHeal: { attempts: 0 },
	};
}

function articleHolding(canonical: VerifiedTierSource): Article {
	return {
		url: URL, metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: 9 },
		freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash(canonical.html) }, estimatedReadTime: 1,
		crawl: { kind: "ready" }, summary: { kind: "ready", summary: "Summary" }, summaryAutoHeal: { attempts: 0 },
		contentSelection: { revision: 1, tier: canonical.tier, candidateId: canonical.metadata.id },
	};
}

function event(detail: unknown): SQSEvent {
	return { Records: [{ messageId: "message-0", receiptHandle: "receipt", body: JSON.stringify({ detail }), attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
}

function reply(decision: object): CreateDeepseekChatCompletion {
	return async () => ({ choices: [{ message: { content: JSON.stringify(decision) } }] });
}

async function selectContent(params: { article: Article; capture: VerifiedTierSource; others: readonly VerifiedTierSource[]; createChatCompletion: CreateDeepseekChatCompletion; legsDeferred: boolean }) {
	const persisted: { transition: unknown; input: unknown }[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, { input }) => { persisted.push({ transition, input }); };
	const info = jest.fn();
	const handler = initSelectMostCompleteContentHandler({
		listAvailableTierSources: async () => [params.capture, ...params.others],
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog: noopLogger, createChatCompletion: params.createChatCompletion }).selectMostCompleteContent,
		runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => params.legsDeferred, now: () => new Date(NOW) }), logger: noopLogger, now: () => new Date(NOW) }),
		writeCanonicalContent: async ({ source }) => ({ contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, originalUrl: URL, tier: source.tier }),
		recordCrawlVersion: async () => {},
		readCanonicalContent: async () => undefined, loadArticle: async () => params.article, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		fetchYouTubeVideoCard: async () => undefined, fetchRedditPostCard: async () => undefined, putTierSource: async (params) => params.metadata,
		now: () => new Date(NOW), logger: { ...noopLogger, info }, deepseekCallFailedLog: noopLogger,
	});

	const result = await handler(event({ url: URL, saveAttemptId: RESCUE, userId: "reader", candidates: [{ id: params.capture.metadata.id, tier: params.capture.tier }] }), buildLambdaContext(), () => {});

	const comparisons = info.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith(COMPARISON_COMPLETED)).map((line) => JSON.parse(line.slice(COMPARISON_COMPLETED.length)));
	return { result, persisted, comparisons: comparisons.map(({ selectionRule, ownCaptureFailed, candidates }) => ({ selectionRule, ownCaptureFailed, captureTrigger: candidates[0].captureTrigger })) };
}

type Outcome = "marked unreadable" | "promoted" | "passed over for the canonical" | "retried" | "left awaiting a reader";

const COMPANIONS = [
	{ companions: "alone", holdsContent: false, article: failedArticle, others: (): VerifiedTierSource[] => [] },
	{ companions: "with the failed crawl's 403 page", holdsContent: false, article: failedArticle, others: () => [candidate({ tier: "tier-1", attemptId: FAILED_CRAWL, httpStatus: 403, wordCount: 4, html: "<p>Verify you are human</p>" })] },
	{ companions: "with committed content present", holdsContent: true, article: () => articleHolding(committedCanonical()), others: () => [committedCanonical()] },
];

const JUDGES: readonly { verdict: string; rule?: PreparedContentSelection["selectionRule"]; withoutContent: Outcome; withContent: Outcome; legsDeferred: boolean; createChatCompletion: (labels: readonly string[]) => CreateDeepseekChatCompletion }[] = [
	{ verdict: "finds nothing readable", rule: "judge", withoutContent: "marked unreadable", withContent: "passed over for the canonical", legsDeferred: false, createChatCompletion: (labels) => reply({ kind: "none", reason: "Nothing readable", readability: labels.map((label) => ({ candidate: label, readable: false })) }) },
	{ verdict: "picks the capture", rule: "judge", withoutContent: "promoted", withContent: "promoted", legsDeferred: false, createChatCompletion: (labels) => reply({ kind: "winner", candidate: labels[0], reason: "The capture is the article", readability: labels.map((label, index) => ({ candidate: label, readable: index === 0 })) }) },
	{ verdict: "is refused by its provider", rule: "provider-rejected-fallback", withoutContent: "promoted", withContent: "passed over for the canonical", legsDeferred: false, createChatCompletion: () => async () => { throw Object.assign(new Error("bad request"), { status: 400 }); } },
	{ verdict: "is deferred until a reader opens the article", rule: "judge-deferred", withoutContent: "left awaiting a reader", withContent: "passed over for the canonical", legsDeferred: true, createChatCompletion: () => async () => { throw new Error("the judge ran while its leg was deferred"); } },
	{ verdict: "fails with HTTP 500", withoutContent: "retried", withContent: "retried", legsDeferred: false, createChatCompletion: () => async () => { throw Object.assign(new Error("server error"), { status: 500 }); } },
];

const ROWS = COMPANIONS.flatMap((companions) => JUDGES.map((judge) => ({
	...companions, ...judge, expected: companions.holdsContent ? judge.withContent : judge.withoutContent,
})));

it.each(ROWS)("an automatic capture $companions, when the judge $verdict, is $expected and never takes a capture rule", async ({ article, others, createChatCompletion, rule, legsDeferred, expected }) => {
	const capture = automaticCapture();
	const companions = others();

	const selection = await selectContent({ article: article(), capture, others: companions, createChatCompletion: createChatCompletion([capture, ...companions].map((_source, index) => labelForIndex(index))), legsDeferred });

	const compared = [{ selectionRule: rule, ownCaptureFailed: false, captureTrigger: "automatic" }];
	const outcomes: Record<Outcome, unknown> = {
		"marked unreadable": { result: { batchItemFailures: [] }, persisted: [{ transition: markNoReadableArticle, input: { reason: { kind: "parse-error", detail: "no readable article candidate: Nothing readable" } } }], comparisons: compared },
		promoted: { result: { batchItemFailures: [] }, persisted: [{ transition: promoteTier, input: expect.objectContaining({ tier: "tier-0", metadata: expect.objectContaining({ id: capture.metadata.id }) }) }], comparisons: compared },
		"passed over for the canonical": { result: { batchItemFailures: [] }, persisted: [{ transition: promoteTier, input: expect.objectContaining({ tier: "tier-1", metadata: expect.objectContaining({ id: committedCanonical().metadata.id }) }) }], comparisons: compared },
		retried: { result: { batchItemFailures: [{ itemIdentifier: "message-0" }] }, persisted: [], comparisons: [] },
		"left awaiting a reader": { result: { batchItemFailures: [] }, persisted: [{ transition: markCrawlAwaitingReader, input: { deferredLeg: "content-judge" } }], comparisons: compared },
	};
	expect(selection).toEqual(outcomes[expected]);
});

it.each([
	{ media: "the canonical's media", image: "https://example.com/figure.jpg", promoted: "canonical" },
	{ media: "different media", image: "https://example.com/figure-retaken.jpg", promoted: "capture" },
] as const)("an automatic capture repeating the committed prose with $media takes the unchanged-content tie a crawl copy takes, without the judge, and the $promoted is promoted", async ({ image, promoted }) => {
	const prose = "<p>The article as an earlier save committed it.</p>";
	const canonical = candidate({ tier: "tier-1", attemptId: EARLIER_SAVE, wordCount: 9, html: `<article>${prose}<img src="https://example.com/figure.jpg"></article>` });
	const capture = candidate({ tier: "tier-0", attemptId: RESCUE, captureTrigger: "automatic", wordCount: 9, html: `<article>${prose}<img src="${image}"></article>` });
	const createChatCompletion = jest.fn<ReturnType<CreateDeepseekChatCompletion>, Parameters<CreateDeepseekChatCompletion>>();

	const selection = await selectContent({ article: articleHolding(canonical), capture, others: [canonical], createChatCompletion, legsDeferred: true });

	expect(createChatCompletion).not.toHaveBeenCalled();
	expect(selection).toEqual({
		result: { batchItemFailures: [] },
		persisted: [{ transition: promoteTier, input: expect.objectContaining({ metadata: expect.objectContaining({ id: { capture, canonical }[promoted].metadata.id }) }) }],
		comparisons: [{ selectionRule: "unchanged-content", ownCaptureFailed: false, captureTrigger: "automatic" }],
	});
});

it("an automatic capture alone, with 100 words or more and no content, takes the lone-body rule a crawl copy takes, without the judge", async () => {
	const capture = candidate({ tier: "tier-0", attemptId: RESCUE, captureTrigger: "automatic", wordCount: 100, html: "<article><h1>Article</h1><p>The page the reader's device loaded on its own, long enough to stand alone.</p></article>" });
	const createChatCompletion = jest.fn<ReturnType<CreateDeepseekChatCompletion>, Parameters<CreateDeepseekChatCompletion>>();

	const selection = await selectContent({ article: failedArticle(), capture, others: [], createChatCompletion, legsDeferred: true });

	expect(createChatCompletion).not.toHaveBeenCalled();
	expect(selection).toEqual({
		result: { batchItemFailures: [] },
		persisted: [{ transition: promoteTier, input: expect.objectContaining({ tier: "tier-0", metadata: expect.objectContaining({ id: capture.metadata.id }) }) }],
		comparisons: [{ selectionRule: "lone-body", ownCaptureFailed: false, captureTrigger: "automatic" }],
	});
});
