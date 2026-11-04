import { type SaveAttemptId, SaveAttemptIdSchema, isStoredWrapperUrl, isWrapperUrl } from "@packages/domain/article";
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
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const URL = "https://example.com/article";
const BOOK_URL = "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef";
const NOW = "2026-10-09T00:00:00.000Z";
const ATTEMPT = SaveAttemptIdSchema.parse("reader-save");
const EARLIER_ATTEMPT = SaveAttemptIdSchema.parse("earlier-save");

const KIND_BY_TIER = { "tier-0": "extension", "tier-1": "live", "tier-2": "wrapper" } as const;

function candidate(params: { tier: "tier-0" | "tier-1" | "tier-2"; html: string; evaluationHtml: string; wordCount: number; httpStatus?: number; attemptId?: SaveAttemptId; url?: string; sourceUrl?: string }): VerifiedTierSource {
	const metadata = candidateProvenance({
		metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: params.wordCount, estimatedReadTime: 1 },
		html: params.html, evaluationHtml: params.evaluationHtml, attemptId: params.attemptId ?? ATTEMPT, originalUrl: params.url ?? URL, sourceUrl: params.sourceUrl ?? params.url ?? URL,
		kind: KIND_BY_TIER[params.tier], fetchedAt: NOW,
	});
	return { tier: params.tier, html: params.html, evaluationHtml: params.evaluationHtml, metadata: { ...metadata, httpStatus: params.httpStatus } };
}

const blankLiveCanonical = (url: string) => candidate({ tier: "tier-1", url, wordCount: 0, httpStatus: 200, attemptId: EARLIER_ATTEMPT, html: "", evaluationHtml: "<html><head><title></title></head><body></body></html>" });

const FIRST_SAVE: Article = {
	url: URL, metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: 0 }, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 1,
	crawl: { kind: "pending", pendingSince: NOW }, summary: { kind: "pending", pendingSince: NOW }, summaryAutoHeal: { attempts: 0 },
};
const blankCanonical = (url: string): Article => ({
	...FIRST_SAVE, url,
	freshness: { contentFetchedAt: NOW, canonicalContentHash: computeCanonicalContentHash("") },
	crawl: { kind: "ready" }, summary: { kind: "skipped", reason: "content-too-short" },
	contentSelection: { revision: 1, tier: "tier-1", candidateId: blankLiveCanonical(url).metadata.id },
});
const legacyBlankCanonical = (url: string): Article => ({ ...blankCanonical(url), contentSelection: { tier: "tier-1" } });

function event(detail: unknown): SQSEvent {
	return { Records: [{ messageId: "message-0", receiptHandle: "receipt", body: JSON.stringify({ detail }), attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
}

function reply(decision: object): CreateDeepseekChatCompletion {
	return async () => ({ choices: [{ message: { content: JSON.stringify(decision) } }] });
}

const ARTICLE_STATES = [
	{ state: "the article's first save", article: (url: string): Article => ({ ...FIRST_SAVE, url }), canonicalContent: undefined, canonical: (_url: string) => [], judgedBesideFresh: 0 },
	{ state: "an article whose blank committed canonical is no longer listed", article: blankCanonical, canonicalContent: { content: "" }, canonical: (_url: string) => [], judgedBesideFresh: 0 },
	{ state: "an article whose blank committed canonical is still listed", article: blankCanonical, canonicalContent: { content: "" }, canonical: (url: string) => [blankLiveCanonical(url)], judgedBesideFresh: 1 },
	{ state: "a legacy article whose stored body is the blank canonical", article: legacyBlankCanonical, canonicalContent: { content: "" }, canonical: (_url: string) => [], judgedBesideFresh: 1 },
];

const PRODUCERS = [
	{
		producer: "an extension, iOS share or Siren upload", url: URL,
		page: { wordCount: 120, html: "<article><h1>Article</h1><p>The page the reader saved.</p></article>", evaluationHtml: "<html><body><nav>Menu</nav><article><h1>Article</h1><p>The page the reader saved.</p></article></body></html>" },
	},
	{
		producer: "a PDF upload", url: URL,
		page: { wordCount: 300, html: "<section><p>Page one of the reader's PDF.</p></section>", evaluationHtml: "<section><p>Page one of the reader's PDF.</p></section>" },
	},
	{
		producer: "a Gmail newsletter issue", url: URL,
		page: { wordCount: 800, html: "<table><tr><td><p>This week's issue.</p></td></tr></table>", evaluationHtml: "<table><tr><td><p>This week's issue.</p></td></tr></table>" },
	},
	{
		producer: "a media-book EPUB upload", url: BOOK_URL,
		page: { wordCount: 2400, html: "<section><h2 id=\"section-1\">Chapter One</h2><p>The book the reader uploaded.</p></section>", evaluationHtml: "<section><h2 id=\"section-1\">Chapter One</h2><p>The book the reader uploaded.</p></section>" },
	},
];

type Page = { url: string; wordCount: number; html: string; evaluationHtml: string };

const COMPANIONS = [
	{ companions: "alone", judged: false, live: (_capture: Page) => [] },
	{ companions: "with this save's live copy of the same page", judged: true, live: (capture: Page) => [candidate({ tier: "tier-1", httpStatus: 200, ...capture })] },
	{ companions: "with this save's tracker copy of the same prose", judged: true, live: (capture: Page) => [candidate({ tier: "tier-2", httpStatus: 200, url: capture.url, sourceUrl: "https://archive.ph/abc12", wordCount: capture.wordCount, html: `<div class="tracker">${capture.html}</div>`, evaluationHtml: `<html><body><header>Archived</header><div class="tracker">${capture.html}</div></body></html>` })] },
	{ companions: "with this save's 404 page", judged: true, live: (capture: Page) => [candidate({ tier: "tier-1", url: capture.url, wordCount: 3, httpStatus: 404, html: "<p>Page not found</p>", evaluationHtml: "<html><body><p>Page not found</p></body></html>" })] },
	{ companions: "with this save's 403 bot check", judged: true, live: (capture: Page) => [candidate({ tier: "tier-1", url: capture.url, wordCount: 4, httpStatus: 403, html: "<p>Verify you are human</p>", evaluationHtml: "<html><body><p>Verify you are human</p></body></html>" })] },
];

const JUDGES = [
	{ verdict: "is deferred until a reader opens the article", whenJudged: "awaiting-reader", legsDeferred: true, createChatCompletion: (): CreateDeepseekChatCompletion => async () => { throw new Error("the judge ran while its leg was deferred"); } },
	{ verdict: "finds nothing readable", whenJudged: "promoted", legsDeferred: false, createChatCompletion: (labels: readonly string[]) => reply({ kind: "none", reason: "Nothing readable", readability: labels.map((candidate) => ({ candidate, readable: false })) }) },
	{ verdict: "is refused by its provider", whenJudged: "promoted", legsDeferred: false, createChatCompletion: (): CreateDeepseekChatCompletion => async () => { throw Object.assign(new Error("bad request"), { status: 400 }); } },
	{ verdict: "contradicts itself", whenJudged: "retried", legsDeferred: false, createChatCompletion: (labels: readonly string[]) => reply({ kind: "none", reason: "Nothing readable", readability: labels.map((candidate) => ({ candidate, readable: true })) }) },
	{ verdict: "fails with HTTP 500", whenJudged: "retried", legsDeferred: false, createChatCompletion: (): CreateDeepseekChatCompletion => async () => { throw Object.assign(new Error("server error"), { status: 500 }); } },
];

const ROWS = ARTICLE_STATES.flatMap((state) => PRODUCERS.flatMap((producer) => COMPANIONS.flatMap((companions) => JUDGES.map((judge) => ({
	...state, ...producer, ...companions, ...judge, expected: companions.judged || state.judgedBesideFresh > 0 ? judge.whenJudged : "promoted",
})))));

it.each(ROWS)("a capture from $producer, $companions, on $state, when the judge $verdict, is $expected and never failed", async ({ url, article, canonicalContent, canonical, judgedBesideFresh, page, live, createChatCompletion, legsDeferred, expected }) => {
	const capture = candidate({ tier: "tier-0", url, ...page });
	const fresh = [capture, ...live({ ...page, url })];
	const sources = [...canonical(url), ...fresh];
	const persisted: { transition: unknown; input: unknown }[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => { persisted.push({ transition, input: params.input }); };
	const handler = initSelectMostCompleteContentHandler({
		listAvailableTierSources: async () => sources,
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog: noopLogger, createChatCompletion: createChatCompletion(Array.from({ length: judgedBesideFresh + new Set(fresh.map((source) => computeCanonicalContentHash(source.html))).size }, (_candidate, index) => labelForIndex(index))) }).selectMostCompleteContent,
		runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => legsDeferred, now: () => new Date(NOW) }), logger: noopLogger, now: () => new Date(NOW) }),
		writeCanonicalContent: async ({ source }) => ({ contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, tier: source.tier }),
		recordCrawlVersion: async () => {},
		readCanonicalContent: async () => canonicalContent, loadArticle: async () => article(url), transitionAndPersist,
		resolveOriginalUrl: async () => url, verifyWrapperSource: async ({ sourceUrl }) => ({ originalUrl: url, sourceUrl }),
		now: () => new Date(NOW), logger: noopLogger, deepseekCallFailedLog: noopLogger,
	});

	const result = await handler(event({ url, saveAttemptId: ATTEMPT, userId: "reader", candidates: fresh.map((source) => ({ id: source.metadata.id, tier: source.tier })) }), buildLambdaContext(), () => {});

	expect(persisted.map((entry) => entry.transition)).not.toContain(markNoReadableArticle);
	expect({ result, persisted }).toEqual(expected === "promoted"
		? { result: { batchItemFailures: [] }, persisted: [{ transition: promoteTier, input: expect.objectContaining({ metadata: expect.objectContaining({ contentHash: capture.metadata.contentHash }) }) }] }
		: expected === "awaiting-reader"
		? { result: { batchItemFailures: [] }, persisted: [{ transition: markCrawlAwaitingReader, input: { deferredLeg: "content-judge" } }] }
		: { result: { batchItemFailures: [{ itemIdentifier: "message-0" }] }, persisted: [] });
});

it("does not take a media-book upload's private URL for a wrapper host", () => {
	expect({ isWrapperUrl: isWrapperUrl(BOOK_URL), isStoredWrapperUrl: isStoredWrapperUrl(BOOK_URL) }).toEqual({ isWrapperUrl: false, isStoredWrapperUrl: false });
});
