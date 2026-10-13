import { type SaveAttemptId, SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { type Article, type TransitionAndPersist, promoteTier } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent } from "aws-lambda";
import { type CreateSelectorChatCompletion, initSelectMostCompleteContent } from "./select-content";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { candidateProvenance } from "./candidate-provenance";
import { labelForIndex } from "./select-content-prompt";
import { markNoReadableArticle } from "./mark-no-readable-article";
import { computeCanonicalContentHash } from "../../providers/article-store/compute-canonical-content-hash";
import type { VerifiedTierSource } from "./tier-source.types";

const URL = "https://example.com/article";
const NOW = "2026-10-09T00:00:00.000Z";
const ATTEMPT = SaveAttemptIdSchema.parse("reader-save");
const EARLIER_ATTEMPT = SaveAttemptIdSchema.parse("earlier-save");

function candidate(params: { tier: "tier-0" | "tier-1"; html: string; evaluationHtml: string; wordCount: number; httpStatus?: number; attemptId?: SaveAttemptId }): VerifiedTierSource {
	const metadata = candidateProvenance({
		metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: params.wordCount, estimatedReadTime: 1 },
		html: params.html, evaluationHtml: params.evaluationHtml, attemptId: params.attemptId ?? ATTEMPT, originalUrl: URL, sourceUrl: URL,
		kind: params.tier === "tier-0" ? "extension" : "live", fetchedAt: NOW,
	});
	return { tier: params.tier, html: params.html, evaluationHtml: params.evaluationHtml, metadata: { ...metadata, httpStatus: params.httpStatus } };
}

const blankLiveCanonical = () => candidate({ tier: "tier-1", wordCount: 0, httpStatus: 200, attemptId: EARLIER_ATTEMPT, html: "", evaluationHtml: "<html><head><title></title></head><body></body></html>" });

const FIRST_SAVE: Article = {
	url: URL, metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: 0 }, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 1,
	crawl: { kind: "pending", pendingSince: NOW }, summary: { kind: "pending", pendingSince: NOW }, summaryAutoHeal: { attempts: 0 },
};
const BLANK_CANONICAL: Article = {
	...FIRST_SAVE,
	freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash("") },
	crawl: { kind: "ready" }, summary: { kind: "skipped", reason: "content-too-short" },
	contentSelection: { revision: 1, tier: "tier-1", candidateId: blankLiveCanonical().metadata.id },
};
const LEGACY_BLANK_CANONICAL: Article = { ...BLANK_CANONICAL, contentSelection: { tier: "tier-1" } };

function event(detail: unknown): SQSEvent {
	return { Records: [{ messageId: "message-0", receiptHandle: "receipt", body: JSON.stringify({ detail }), attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
}

function reply(decision: object): CreateSelectorChatCompletion {
	return async () => ({ choices: [{ message: { content: JSON.stringify(decision) } }] });
}

const ARTICLE_STATES = [
	{ state: "the article's first save", article: FIRST_SAVE, canonicalContent: undefined, canonical: () => [], judgedBesideFresh: 0 },
	{ state: "an article whose blank committed canonical is no longer listed", article: BLANK_CANONICAL, canonicalContent: { content: "" }, canonical: () => [], judgedBesideFresh: 0 },
	{ state: "an article whose blank committed canonical is still listed", article: BLANK_CANONICAL, canonicalContent: { content: "" }, canonical: () => [blankLiveCanonical()], judgedBesideFresh: 1 },
	{ state: "a legacy article whose stored body is the blank canonical", article: LEGACY_BLANK_CANONICAL, canonicalContent: { content: "" }, canonical: () => [], judgedBesideFresh: 1 },
];

const PRODUCERS = [
	{
		producer: "an extension, iOS share or Siren upload",
		capture: () => candidate({ tier: "tier-0", wordCount: 120, html: "<article><h1>Article</h1><p>The page the reader saved.</p></article>", evaluationHtml: "<html><body><nav>Menu</nav><article><h1>Article</h1><p>The page the reader saved.</p></article></body></html>" }),
	},
	{
		producer: "a PDF upload",
		capture: () => candidate({ tier: "tier-0", wordCount: 300, html: "<section><p>Page one of the reader's PDF.</p></section>", evaluationHtml: "<section><p>Page one of the reader's PDF.</p></section>" }),
	},
	{
		producer: "a Gmail newsletter issue",
		capture: () => candidate({ tier: "tier-0", wordCount: 800, html: "<table><tr><td><p>This week's issue.</p></td></tr></table>", evaluationHtml: "<table><tr><td><p>This week's issue.</p></td></tr></table>" }),
	},
];

const COMPANIONS = [
	{ companions: "alone", judged: false, live: () => [] },
	{ companions: "with this save's 404 page", judged: true, live: () => [candidate({ tier: "tier-1", wordCount: 3, httpStatus: 404, html: "<p>Page not found</p>", evaluationHtml: "<html><body><p>Page not found</p></body></html>" })] },
	{ companions: "with this save's 403 bot check", judged: true, live: () => [candidate({ tier: "tier-1", wordCount: 4, httpStatus: 403, html: "<p>Verify you are human</p>", evaluationHtml: "<html><body><p>Verify you are human</p></body></html>" })] },
];

const JUDGES = [
	{ verdict: "finds nothing readable", whenJudged: "promoted", createChatCompletion: (labels: readonly string[]) => reply({ kind: "none", reason: "Nothing readable", readability: labels.map((candidate) => ({ candidate, readable: false })) }) },
	{ verdict: "is refused by its provider", whenJudged: "promoted", createChatCompletion: (): CreateSelectorChatCompletion => async () => { throw Object.assign(new Error("bad request"), { status: 400 }); } },
	{ verdict: "contradicts itself", whenJudged: "retried", createChatCompletion: (labels: readonly string[]) => reply({ kind: "none", reason: "Nothing readable", readability: labels.map((candidate) => ({ candidate, readable: true })) }) },
	{ verdict: "fails with HTTP 500", whenJudged: "retried", createChatCompletion: (): CreateSelectorChatCompletion => async () => { throw Object.assign(new Error("server error"), { status: 500 }); } },
];

const ROWS = ARTICLE_STATES.flatMap((state) => PRODUCERS.flatMap((producer) => COMPANIONS.flatMap((companions) => JUDGES.map((judge) => ({
	...state, ...producer, ...companions, ...judge, expected: companions.judged || state.judgedBesideFresh > 0 ? judge.whenJudged : "promoted",
})))));

it.each(ROWS)("a capture from $producer, $companions, on $state, when the judge $verdict, is $expected and never failed", async ({ article, canonicalContent, canonical, judgedBesideFresh, capture: buildCapture, live, createChatCompletion, expected }) => {
	const capture = buildCapture();
	const fresh = [capture, ...live()];
	const sources = [...canonical(), ...fresh];
	const persisted: { transition: unknown; input: unknown }[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => { persisted.push({ transition, input: params.input }); };
	const handler = initSelectMostCompleteContentHandler({
		listAvailableTierSources: async () => sources,
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, createChatCompletion: createChatCompletion(Array.from({ length: judgedBesideFresh + fresh.length }, (_candidate, index) => labelForIndex(index))) }).selectMostCompleteContent,
		writeCanonicalContent: async ({ source }) => ({ contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, originalUrl: URL, tier: source.tier }),
		recordCrawlVersion: async () => {},
		readCanonicalContent: async () => canonicalContent, loadArticle: async () => article, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		now: () => new Date(NOW), logger: noopLogger,
	});

	const result = await handler(event({ url: URL, saveAttemptId: ATTEMPT, userId: "reader", candidates: fresh.map((source) => ({ id: source.metadata.id, tier: source.tier })) }), buildLambdaContext(), () => {});

	expect(persisted.map((entry) => entry.transition)).not.toContain(markNoReadableArticle);
	expect({ result, persisted }).toEqual(expected === "promoted"
		? { result: { batchItemFailures: [] }, persisted: [{ transition: promoteTier, input: expect.objectContaining({ tier: "tier-0", metadata: expect.objectContaining({ id: capture.metadata.id }) }) }] }
		: { result: { batchItemFailures: [{ itemIdentifier: "message-0" }] }, persisted: [] });
});
