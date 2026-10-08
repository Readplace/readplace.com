import { SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/hutch-logger";
import { type Article, type TransitionAndPersist, promoteTier } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent } from "aws-lambda";
import { type CreateSelectorChatCompletion, initSelectMostCompleteContent } from "./select-content";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { candidateProvenance } from "./candidate-provenance";
import { markNoReadableArticle } from "./mark-no-readable-article";
import type { VerifiedTierSource } from "./tier-source.types";

const URL = "https://example.com/article";
const NOW = "2026-10-09T00:00:00.000Z";
const ATTEMPT = SaveAttemptIdSchema.parse("reader-save");
const FIRST_SAVE: Article = {
	url: URL, metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: 0 }, freshness: { contentFetchedAt: NOW }, estimatedReadTime: 1,
	crawl: { kind: "pending", pendingSince: NOW }, summary: { kind: "pending", pendingSince: NOW }, summaryAutoHeal: { attempts: 0 },
};

function candidate(params: { tier: "tier-0" | "tier-1"; html: string; evaluationHtml: string; wordCount: number; httpStatus?: number }): VerifiedTierSource {
	const metadata = candidateProvenance({
		metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: params.wordCount, estimatedReadTime: 1 },
		html: params.html, evaluationHtml: params.evaluationHtml, attemptId: ATTEMPT, originalUrl: URL, sourceUrl: URL,
		kind: params.tier === "tier-0" ? "extension" : "live", fetchedAt: NOW,
	});
	return { tier: params.tier, html: params.html, evaluationHtml: params.evaluationHtml, metadata: { ...metadata, httpStatus: params.httpStatus } };
}

function event(detail: unknown): SQSEvent {
	return { Records: [{ messageId: "message-0", receiptHandle: "receipt", body: JSON.stringify({ detail }), attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" }] };
}

function reply(decision: object): CreateSelectorChatCompletion {
	return async () => ({ choices: [{ message: { content: JSON.stringify(decision) } }] });
}

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
	{ verdict: "finds nothing readable", whenJudged: "promoted", createChatCompletion: (ids: readonly string[]) => reply({ kind: "none", reason: "Nothing readable", readability: ids.map((candidateId) => ({ candidateId, readable: false })) }) },
	{ verdict: "is refused by its provider", whenJudged: "promoted", createChatCompletion: (): CreateSelectorChatCompletion => async () => { throw Object.assign(new Error("bad request"), { status: 400 }); } },
	{ verdict: "contradicts itself", whenJudged: "retried", createChatCompletion: (ids: readonly string[]) => reply({ kind: "none", reason: "Nothing readable", readability: ids.map((candidateId) => ({ candidateId, readable: true })) }) },
	{ verdict: "fails with HTTP 500", whenJudged: "retried", createChatCompletion: (): CreateSelectorChatCompletion => async () => { throw Object.assign(new Error("server error"), { status: 500 }); } },
];

const ROWS = PRODUCERS.flatMap((producer) => COMPANIONS.flatMap((companions) => JUDGES.map((judge) => ({
	...producer, ...companions, ...judge, expected: companions.judged ? judge.whenJudged : "promoted",
}))));

it.each(ROWS)("a capture from $producer, $companions, when the judge $verdict, is $expected and never failed", async ({ capture: buildCapture, live, createChatCompletion, expected }) => {
	const capture = buildCapture();
	const sources = [capture, ...live()];
	const persisted: { transition: unknown; input: unknown }[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => { persisted.push({ transition, input: params.input }); };
	const handler = initSelectMostCompleteContentHandler({
		listAvailableTierSources: async () => sources,
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, createChatCompletion: createChatCompletion(sources.map((source) => source.metadata.id)) }).selectMostCompleteContent,
		writeCanonicalContent: async ({ source }) => ({ contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, originalUrl: URL, tier: source.tier }),
		recordCrawlVersion: async () => {},
		readCanonicalContent: async () => undefined, loadArticle: async () => FIRST_SAVE, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		now: () => new Date(NOW), logger: noopLogger,
	});

	const result = await handler(event({ url: URL, saveAttemptId: ATTEMPT, userId: "reader", candidates: sources.map((source) => ({ id: source.metadata.id, tier: source.tier })) }), buildLambdaContext(), () => {});

	expect(persisted.map((entry) => entry.transition)).not.toContain(markNoReadableArticle);
	expect({ result, persisted }).toEqual(expected === "promoted"
		? { result: { batchItemFailures: [] }, persisted: [{ transition: promoteTier, input: expect.objectContaining({ tier: "tier-0", metadata: expect.objectContaining({ id: capture.metadata.id }) }) }] }
		: { result: { batchItemFailures: [{ itemIdentifier: "message-0" }] }, persisted: [] });
});
