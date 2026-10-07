import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initSelectMostCompleteContent } from "./select-content";
import { noopLogger } from "@packages/hutch-logger";
import { type Article, type TransitionAndPersist, promoteTier, recrawlPromoteTier, refreshContent } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent } from "aws-lambda";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { initRecrawlContentExtractedHandler } from "./recrawl-content-extracted-handler";
import { initRefreshContentExtractedHandler } from "./refresh-content-extracted-handler";
import type { SelectContentDependencies } from "./select-content-work";
import { candidateProvenance } from "./candidate-provenance";
import type { VerifiedTierSource } from "./tier-source.types";
import { markNoReadableArticle } from "./mark-no-readable-article";

const URL = "https://example.com/article";
const NOW = new Date("2026-10-05T00:00:00.000Z");
const source: VerifiedTierSource = { tier: "tier-1", html: "<p>Real article content</p>", metadata: candidateProvenance({ metadata: { title: "Real title", siteName: "Example", excerpt: "Article excerpt", wordCount: 100, estimatedReadTime: 1 }, html: "<p>Real article content</p>", evaluationHtml: "<p>Real article content</p>", attemptId: SaveAttemptIdSchema.parse("save-attempt"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: NOW.toISOString() }) };
const article: Article = { url: URL, metadata: { title: "Old", siteName: "Example", excerpt: "Old excerpt", wordCount: 3 }, freshness: { contentFetchedAt: NOW.toISOString() }, estimatedReadTime: 1, crawl: { kind: "pending", pendingSince: NOW.toISOString() }, summary: { kind: "pending", pendingSince: NOW.toISOString() }, summaryAutoHeal: { attempts: 0 } };
function event(...details: unknown[]): SQSEvent {
	return { Records: details.map((item, index) => ({ messageId: `message-${index}`, receiptHandle: "receipt", body: JSON.stringify({ detail: item }), attributes: { ApproximateReceiveCount: "1", SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" })) };
}
const candidateDetail = { url: URL, saveAttemptId: "save-attempt", candidates: [{ id: source.metadata.id, tier: source.tier }] };

it("terminalizes an article with no readable candidate as a failed crawl with a skipped summary", () => {
	const terminal = markNoReadableArticle(article, { reason: { kind: "parse-error", detail: "all received pages are unreadable" } });
	expect(terminal.article.crawl).toEqual({ kind: "failed", reason: { kind: "parse-error", detail: "all received pages are unreadable" } });
	expect(terminal.article.summary).toEqual({ kind: "skipped", reason: "crawl-failed" });
	expect(terminal.writes).toEqual(["crawl", "summary"]);
	expect(terminal.effects).toEqual([{ kind: "publish-crawl-article-completed", url: URL }]);
});

function setupHandler(init: typeof initSelectMostCompleteContentHandler, overrides: Partial<SelectContentDependencies> = {}) {
	const persisted: { transition: unknown; params: { input: unknown; canonicalCommit?: unknown; selectionExpected?: unknown } }[] = [];
	const order: string[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => { order.push("commit"); persisted.push({ transition, params }); };
	const handler = init({
		listAvailableTierSources: async () => [source],
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, createChatCompletion: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "winner", candidateId: source.metadata.id, reason: "readable article", readability: [{ candidateId: source.metadata.id, readable: true }] }) } }] }) }).selectMostCompleteContent,
		writeCanonicalContent: async () => { order.push("upload"); return { contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, originalUrl: URL, tier: source.tier }; },
		recordCrawlVersion: async () => { order.push("version"); },
		readCanonicalContent: async () => undefined, loadArticle: async () => article,
		transitionAndPersist,
		resolveOriginalUrl: async () => URL,
		verifyWrapperSource: async () => undefined,
		now: () => NOW,
		logger: noopLogger,
		...overrides,
	});
	return { handler, persisted, order };
}

describe.each([
	{ name: "save", init: initSelectMostCompleteContentHandler, detail: { ...candidateDetail, userId: "user-1" }, transition: promoteTier, input: { userId: "user-1" } },
	{ name: "recrawl", init: initRecrawlContentExtractedHandler, detail: candidateDetail, transition: recrawlPromoteTier, input: { winnerTier: "tier-1" } },
	{ name: "refresh", init: initRefreshContentExtractedHandler, detail: { ...candidateDetail, contentFetchedAt: "2026-10-05T00:00:00.000Z", bodyHash: "raw-hash", etag: "current-etag", lastModified: "current-date" }, transition: refreshContent, input: { freshness: { bodyHash: "raw-hash", etag: "current-etag", lastModified: "current-date" } } },
])("$name selection queue handler", ({ init, detail, transition, input }) => {
	it("commits the event's exact judged candidate and refreshed metadata before recording its version", async () => {
		const { handler, persisted, order } = setupHandler(init);
		const result = await handler(event(detail), buildLambdaContext(), () => {});
		expect(result).toEqual({ batchItemFailures: [] });
		expect(order).toEqual(["upload", "commit", "version"]);
		expect(persisted[0]?.transition).toBe(transition);
		expect(persisted[0]?.params.canonicalCommit).toMatchObject({ candidateId: source.metadata.id, contentLocation: "s3://content/immutable.html" });
		expect(persisted[0]?.params.input).toMatchObject({ metadata: { title: "Real title", excerpt: "Article excerpt", wordCount: 100 }, canonicalContentHash: expect.any(String) });
		expect(persisted[0]?.params.input).toMatchObject(input);
	});
	it("retries malformed queue input without affecting the valid sibling", async () => {
		const { handler } = setupHandler(init);
		expect(await handler(event({ url: 123 }, detail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
	});
});

it("retries a conditional commit conflict and continues processing sibling records", async () => {
	let attempts = 0;
	const detail = { ...candidateDetail, userId: "user-1" };
	const { handler } = setupHandler(initSelectMostCompleteContentHandler, { transitionAndPersist: async () => { attempts += 1; if (attempts === 1) throw new Error("selection revision changed"); } });
	expect(await handler(event(detail, detail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
	expect(attempts).toBe(2);
});
