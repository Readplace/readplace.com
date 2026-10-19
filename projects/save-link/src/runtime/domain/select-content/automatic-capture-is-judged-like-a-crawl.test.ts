import { type CaptureTrigger, type SaveAttemptId, SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { type Article, type TransitionAndPersist, promoteTier } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent } from "aws-lambda";
import { type CreateSelectorChatCompletion, initSelectMostCompleteContent } from "./select-content";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { candidateProvenance } from "./candidate-provenance";
import { labelForIndex } from "./select-content-prompt";
import { markNoReadableArticle } from "./mark-no-readable-article";
import { COMPARISON_COMPLETED } from "./comparison-log";
import type { PreparedContentSelection } from "./prepare-content-selection";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import type { VerifiedTierSource } from "./tier-source.types";

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

function reply(decision: object): CreateSelectorChatCompletion {
	return async () => ({ choices: [{ message: { content: JSON.stringify(decision) } }] });
}

async function selectContent(params: { article: Article; capture: VerifiedTierSource; others: readonly VerifiedTierSource[]; createChatCompletion: CreateSelectorChatCompletion }) {
	const persisted: { transition: unknown; input: unknown }[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, { input }) => { persisted.push({ transition, input }); };
	const info = jest.fn();
	const handler = initSelectMostCompleteContentHandler({
		listAvailableTierSources: async () => [params.capture, ...params.others],
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, createChatCompletion: params.createChatCompletion }).selectMostCompleteContent,
		writeCanonicalContent: async ({ source }) => ({ contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, originalUrl: URL, tier: source.tier }),
		recordCrawlVersion: async () => {},
		readCanonicalContent: async () => undefined, loadArticle: async () => params.article, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		now: () => new Date(NOW), logger: { ...noopLogger, info },
	});

	const result = await handler(event({ url: URL, saveAttemptId: RESCUE, userId: "reader", candidates: [{ id: params.capture.metadata.id, tier: params.capture.tier }] }), buildLambdaContext(), () => {});

	const comparisons = info.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith(COMPARISON_COMPLETED)).map((line) => JSON.parse(line.slice(COMPARISON_COMPLETED.length)));
	return { result, persisted, comparisons: comparisons.map(({ selectionRule, ownCaptureFailed, candidates }) => ({ selectionRule, ownCaptureFailed, captureTrigger: candidates[0].captureTrigger })) };
}

type Outcome = "marked unreadable" | "promoted" | "passed over for the canonical" | "retried";

const COMPANIONS = [
	{ companions: "alone", holdsContent: false, article: failedArticle, others: (): VerifiedTierSource[] => [] },
	{ companions: "with the failed crawl's 403 page", holdsContent: false, article: failedArticle, others: () => [candidate({ tier: "tier-1", attemptId: FAILED_CRAWL, httpStatus: 403, wordCount: 4, html: "<p>Verify you are human</p>" })] },
	{ companions: "with committed content present", holdsContent: true, article: () => articleHolding(committedCanonical()), others: () => [committedCanonical()] },
];

const JUDGES: readonly { verdict: string; rule?: PreparedContentSelection["selectionRule"]; withoutContent: Outcome; withContent: Outcome; createChatCompletion: (labels: readonly string[]) => CreateSelectorChatCompletion }[] = [
	{ verdict: "finds nothing readable", rule: "judge", withoutContent: "marked unreadable", withContent: "passed over for the canonical", createChatCompletion: (labels) => reply({ kind: "none", reason: "Nothing readable", readability: labels.map((label) => ({ candidate: label, readable: false })) }) },
	{ verdict: "picks the capture", rule: "judge", withoutContent: "promoted", withContent: "promoted", createChatCompletion: (labels) => reply({ kind: "winner", candidate: labels[0], reason: "The capture is the article", readability: labels.map((label, index) => ({ candidate: label, readable: index === 0 })) }) },
	{ verdict: "is refused by its provider", rule: "provider-rejected-fallback", withoutContent: "promoted", withContent: "passed over for the canonical", createChatCompletion: () => async () => { throw Object.assign(new Error("bad request"), { status: 400 }); } },
	{ verdict: "fails with HTTP 500", withoutContent: "retried", withContent: "retried", createChatCompletion: () => async () => { throw Object.assign(new Error("server error"), { status: 500 }); } },
];

const ROWS = COMPANIONS.flatMap((companions) => JUDGES.map((judge) => ({
	...companions, ...judge, expected: companions.holdsContent ? judge.withContent : judge.withoutContent,
})));

it.each(ROWS)("an automatic capture $companions, when the judge $verdict, is $expected and never takes a capture rule", async ({ article, others, createChatCompletion, rule, expected }) => {
	const capture = automaticCapture();
	const companions = others();

	const selection = await selectContent({ article: article(), capture, others: companions, createChatCompletion: createChatCompletion([capture, ...companions].map((_source, index) => labelForIndex(index))) });

	const compared = [{ selectionRule: rule, ownCaptureFailed: false, captureTrigger: "automatic" }];
	const outcomes: Record<Outcome, unknown> = {
		"marked unreadable": { result: { batchItemFailures: [] }, persisted: [{ transition: markNoReadableArticle, input: { reason: { kind: "capture-unreadable", detail: "no readable article candidate: Nothing readable" } } }], comparisons: compared },
		promoted: { result: { batchItemFailures: [] }, persisted: [{ transition: promoteTier, input: expect.objectContaining({ tier: "tier-0", metadata: expect.objectContaining({ id: capture.metadata.id }) }) }], comparisons: compared },
		"passed over for the canonical": { result: { batchItemFailures: [] }, persisted: [{ transition: promoteTier, input: expect.objectContaining({ tier: "tier-1", metadata: expect.objectContaining({ id: committedCanonical().metadata.id }) }) }], comparisons: compared },
		retried: { result: { batchItemFailures: [{ itemIdentifier: "message-0" }] }, persisted: [], comparisons: [] },
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
	const createChatCompletion = jest.fn<ReturnType<CreateSelectorChatCompletion>, Parameters<CreateSelectorChatCompletion>>();

	const selection = await selectContent({ article: articleHolding(canonical), capture, others: [canonical], createChatCompletion });

	expect(createChatCompletion).not.toHaveBeenCalled();
	expect(selection).toEqual({
		result: { batchItemFailures: [] },
		persisted: [{ transition: promoteTier, input: expect.objectContaining({ metadata: expect.objectContaining({ id: { capture, canonical }[promoted].metadata.id }) }) }],
		comparisons: [{ selectionRule: "unchanged-content", ownCaptureFailed: false, captureTrigger: "automatic" }],
	});
});
