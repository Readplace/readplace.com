import { SaveAttemptIdSchema } from "@packages/domain/article";
import { initSelectMostCompleteContent } from "./select-content";
import { noopLogger } from "@packages/logger";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { type Article, type TransitionAndPersist, markCrawlExhausted, promoteTier, recrawlPromoteTier, refreshContent } from "@packages/domain/article-aggregate";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import type { SQSEvent } from "aws-lambda";
import { initSelectMostCompleteContentHandler } from "./select-most-complete-content-handler";
import { initRecrawlContentExtractedHandler } from "./recrawl-content-extracted-handler";
import { initRefreshContentExtractedHandler } from "./refresh-content-extracted-handler";
import { candidateProvenance, type VerifiedTierSource } from "@packages/tier-source";
import { markNoReadableArticle } from "./mark-no-readable-article";
import { SELECT_CONTENT_MAX_RECEIVE_COUNT } from "./max-receive-count";

const URL = "https://example.com/article";
const NOW = new Date("2026-10-05T00:00:00.000Z");
const source: VerifiedTierSource = { tier: "tier-1", html: "<p>Real article content</p>", metadata: candidateProvenance({ metadata: { title: "Real title", siteName: "Example", excerpt: "Article excerpt", wordCount: 99, estimatedReadTime: 1 }, html: "<p>Real article content</p>", evaluationHtml: "<p>Real article content</p>", attemptId: SaveAttemptIdSchema.parse("save-attempt"), originalUrl: URL, sourceUrl: URL, kind: "live", fetchedAt: NOW.toISOString() }) };
const article: Article = { url: URL, metadata: { title: "Old", siteName: "Example", excerpt: "Old excerpt", wordCount: 3 }, freshness: { contentFetchedAt: NOW.toISOString() }, estimatedReadTime: 1, crawl: { kind: "pending", pendingSince: NOW.toISOString() }, summary: { kind: "pending", pendingSince: NOW.toISOString() }, summaryAutoHeal: { attempts: 0 } };
function event(...details: unknown[]): SQSEvent {
	return eventOnReceive(1, ...details);
}
function eventOnReceive(receiveCount: number, ...details: unknown[]): SQSEvent {
	return { Records: details.map((item, index) => ({ messageId: `message-${index}`, receiptHandle: "receipt", body: JSON.stringify({ detail: item }), attributes: { ApproximateReceiveCount: String(receiveCount), SentTimestamp: "1", SenderId: "sender", ApproximateFirstReceiveTimestamp: "1" }, messageAttributes: {}, md5OfBody: "", eventSource: "aws:sqs", eventSourceARN: "arn:aws:sqs:ap-southeast-2:123:test", awsRegion: "ap-southeast-2" })) };
}
const candidateDetail = { url: URL, saveAttemptId: "save-attempt", candidates: [{ id: source.metadata.id, tier: source.tier }] };

it("terminalizes an article with no readable candidate as a failed crawl with a skipped summary", () => {
	const terminal = markNoReadableArticle(article, { reason: { kind: "parse-error", detail: "all received pages are unreadable" } });
	expect(terminal.article.crawl).toEqual({ kind: "failed", reason: { kind: "parse-error", detail: "all received pages are unreadable" } });
	expect(terminal.article.summary).toEqual({ kind: "skipped", reason: "crawl-failed" });
	expect(terminal.writes).toEqual(["crawl", "summary"]);
	expect(terminal.effects).toEqual([{ kind: "publish-crawl-article-completed", url: URL }]);
});

function setupHandler(init: typeof initSelectMostCompleteContentHandler, overrides: Partial<Parameters<typeof initSelectMostCompleteContentHandler>[0]> = {}) {
	const persisted: { transition: unknown; params: { input: unknown; canonicalCommit?: unknown; selectionExpected?: unknown } }[] = [];
	const order: string[] = [];
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => { order.push("commit"); persisted.push({ transition, params }); };
	const handler = init({
		listAvailableTierSources: async () => [source],
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog: noopLogger, createChatCompletion: async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "winner", candidate: "A", reason: "readable article", readability: [{ candidate: "A", readable: true }] }) } }] }) }).selectMostCompleteContent,
		runMeteredLeg: initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW }), logger: noopLogger, now: () => NOW }),
		writeCanonicalContent: async () => { order.push("upload"); return { contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, tier: source.tier }; },
		recordCrawlVersion: async () => { order.push("version"); },
		readCanonicalContent: async () => undefined, loadArticle: async () => article,
		transitionAndPersist,
		resolveOriginalUrl: async () => URL,
		verifyWrapperSource: async () => undefined,
		fetchRedditPostCard: async () => undefined,
		fetchYouTubeVideoCard: async () => undefined,
		putTierSource: async (params) => params.metadata,
		now: () => NOW,
		logger: noopLogger,
		deepseekCallFailedLog: noopLogger,
		...overrides,
	});
	return { handler, persisted, order };
}

describe.each([
	{ name: "save", init: initSelectMostCompleteContentHandler, detail: { ...candidateDetail, userId: "user-1" }, transition: promoteTier, input: { tier: "tier-1", canonicalChanged: true } },
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
		expect(persisted[0]?.params.input).toMatchObject({ metadata: { title: "Real title", excerpt: "Article excerpt", wordCount: 99 }, canonicalContentHash: expect.any(String) });
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

describe("deepseek-call-failed line", () => {
	const detail = { ...candidateDetail, userId: "user-1" };
	it("writes one deepseek-call-failed line for a provider error and still fails the record", async () => {
		const deepseekCallFailed = jest.fn();
		const deepseekCallFailedLog = { ...noopLogger, error: deepseekCallFailed };
		const createChatCompletion = jest.fn(async () => { throw Object.assign(new Error("402 Insufficient Balance"), { status: 402, requestID: null }); });
		const { handler } = setupHandler(initSelectMostCompleteContentHandler, {
			selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog, createChatCompletion }).selectMostCompleteContent,
			deepseekCallFailedLog,
		});
		expect(await handler(event(detail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
		expect(createChatCompletion).toHaveBeenCalledTimes(1);
		expect(deepseekCallFailed).toHaveBeenCalledTimes(1);
		const line = deepseekCallFailed.mock.calls[0][0];
		expect(line).toMatchObject({ feature: "select-most-complete-content", status: 402, kind: "http", messageId: "message-0", receiveCount: 1 });
		expect(line).not.toHaveProperty("url");
		expect(line).not.toHaveProperty("requestId");
	});
	it("names the recrawl feature", async () => {
		const deepseekCallFailed = jest.fn();
		const { handler } = setupHandler(initRecrawlContentExtractedHandler, {
			selectMostCompleteContent: async () => { throw Object.assign(new Error("402 Insufficient Balance"), { status: 402, requestID: null }); },
			deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed },
		});
		expect(await handler(event(candidateDetail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
		expect(deepseekCallFailed).toHaveBeenCalledTimes(1);
		expect(deepseekCallFailed.mock.calls[0][0]).toMatchObject({ feature: "recrawl-content-extracted", status: 402, kind: "http" });
	});
	it.each([
		{ name: "a storage failure", overrides: { listAvailableTierSources: async () => { throw new Error("S3 unavailable"); } }, body: detail },
		{ name: "a malformed queue body", overrides: {}, body: { url: 123 } },
	])("writes no deepseek line for $name", async ({ overrides, body }) => {
		const deepseekCallFailed = jest.fn();
		const { handler } = setupHandler(initSelectMostCompleteContentHandler, { ...overrides, deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed } });
		expect(await handler(event(body), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
		expect(deepseekCallFailed).not.toHaveBeenCalled();
	});
	it("names the refresh feature", async () => {
		const deepseekCallFailed = jest.fn();
		const { handler } = setupHandler(initRefreshContentExtractedHandler, {
			selectMostCompleteContent: async () => { throw new DOMException("This operation was aborted", "AbortError"); },
			deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed },
		});
		await handler(event({ ...candidateDetail, contentFetchedAt: "2026-10-05T00:00:00.000Z", bodyHash: "raw-hash", etag: "current-etag", lastModified: "current-date" }), buildLambdaContext(), () => {});
		expect(deepseekCallFailed).toHaveBeenCalledTimes(1);
		expect(deepseekCallFailed.mock.calls[0][0]).toMatchObject({ feature: "refresh-content-extracted", kind: "timeout" });
	});
});

describe("final-receive mark", () => {
	const saveDetail = { ...candidateDetail, userId: "user-1" };
	const providerError = async () => { throw Object.assign(new Error("402 Insufficient Balance"), { status: 402, requestID: null }); };
	function structuredErrorLines(error: jest.Mock): Record<string, unknown>[] {
		return error.mock.calls.map(([line]) => line).filter((line): line is string => typeof line === "string" && line.startsWith("{")).map((line) => JSON.parse(line));
	}

	describe.each([
		{ name: "save", init: initSelectMostCompleteContentHandler, detail: saveDetail, tag: "SelectContent", feature: "select-most-complete-content" },
		{ name: "recrawl", init: initRecrawlContentExtractedHandler, detail: candidateDetail, tag: "RecrawlContentExtracted", feature: "recrawl-content-extracted" },
	])("$name", ({ init, detail, tag, feature }) => {
		it("marks the crawl exhausted on the final receive, logs the dead-lettered line and still fails the record", async () => {
			const error = jest.fn();
			const deepseekCallFailed = jest.fn();
			const { handler, persisted } = setupHandler(init, { selectMostCompleteContent: providerError, logger: { ...noopLogger, error }, deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed } });
			expect(await handler(eventOnReceive(SELECT_CONTENT_MAX_RECEIVE_COUNT, detail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
			expect(persisted).toEqual([{ transition: markCrawlExhausted, params: { url: URL, input: { reason: { kind: "exhausted-retries", receiveCount: 3 }, receiveCount: 3 } } }]);
			expect(structuredErrorLines(error)).toEqual([expect.objectContaining({ level: "ERROR", message: `[${tag}] dead-lettered after 3 receives (messageId message-0); marking crawl exhausted`, url: URL })]);
			expect(deepseekCallFailed).toHaveBeenCalledTimes(1);
			expect(deepseekCallFailed.mock.calls[0][0]).toMatchObject({ feature, status: 402, receiveCount: 3, messageId: "message-0" });
		});
		it("marks nothing before the final receive", async () => {
			const { handler, persisted } = setupHandler(init, { selectMostCompleteContent: providerError });
			expect(await handler(eventOnReceive(SELECT_CONTENT_MAX_RECEIVE_COUNT - 1, detail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
			expect(persisted).toEqual([]);
		});
	});

	it("a storage failure on the final receive is marked and writes no deepseek line", async () => {
		const deepseekCallFailed = jest.fn();
		const { handler, persisted } = setupHandler(initSelectMostCompleteContentHandler, { listAvailableTierSources: async () => { throw new Error("S3 unavailable"); }, deepseekCallFailedLog: { ...noopLogger, error: deepseekCallFailed } });
		expect(await handler(eventOnReceive(SELECT_CONTENT_MAX_RECEIVE_COUNT, saveDetail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
		expect(persisted.map(({ transition }) => transition)).toEqual([markCrawlExhausted]);
		expect(deepseekCallFailed).not.toHaveBeenCalled();
	});

	it("a malformed body on the final receive marks nothing", async () => {
		const { handler, persisted } = setupHandler(initSelectMostCompleteContentHandler);
		expect(await handler(eventOnReceive(SELECT_CONTENT_MAX_RECEIVE_COUNT, { url: 123 }), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
		expect(persisted).toEqual([]);
	});

	it("refresh acknowledges a refused redrive", async () => {
		const { handler, persisted } = setupHandler(initRefreshContentExtractedHandler, {
			selectMostCompleteContent: async () => { throw new Error("a refused redrive must not reach the judge"); },
			loadArticle: async () => ({ ...article, freshness: { contentFetchedAt: "2026-10-06T00:00:00.000Z" } }),
		});
		const refreshDetail = { ...candidateDetail, contentFetchedAt: "2026-10-05T00:00:00.000Z", bodyHash: "raw-hash" };
		expect(await handler(event(refreshDetail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
		expect(persisted).toEqual([]);
	});

	it("refresh keeps its row on the final receive", async () => {
		const { handler, persisted } = setupHandler(initRefreshContentExtractedHandler, { selectMostCompleteContent: providerError });
		const refreshDetail = { ...candidateDetail, contentFetchedAt: "2026-10-05T00:00:00.000Z", bodyHash: "raw-hash" };
		expect(await handler(eventOnReceive(SELECT_CONTENT_MAX_RECEIVE_COUNT, refreshDetail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
		expect(persisted).toEqual([]);
	});

	it.each([
		{ name: "an Error", thrown: new Error("conditional check failed"), stackStart: "Error: conditional check failed" },
		{ name: "a string", thrown: "conditional check failed", stackStart: "Error: conditional check failed" },
	])("a mark that throws $name logs the exhausted-mark line and still fails the record", async ({ thrown, stackStart }) => {
		const error = jest.fn();
		const { handler } = setupHandler(initSelectMostCompleteContentHandler, {
			selectMostCompleteContent: providerError,
			transitionAndPersist: async (transition) => { if (transition === markCrawlExhausted) throw thrown; },
			logger: { ...noopLogger, error },
		});
		expect(await handler(eventOnReceive(SELECT_CONTENT_MAX_RECEIVE_COUNT, saveDetail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [{ itemIdentifier: "message-0" }] });
		const lines = structuredErrorLines(error);
		expect(lines).toEqual([expect.objectContaining({ message: "[SelectContent] exhausted-mark record failed on receive 3 (messageId message-0)", url: URL, name: "Error" })]);
		expect(String(lines[0]?.stack).startsWith(stackStart)).toBe(true);
	});

	it("a winner after a failed row ends with the crawl ready", async () => {
		const failedArticle: Article = { ...article, crawl: { kind: "failed", reason: { kind: "exhausted-retries", receiveCount: 3 } } };
		const results: Article[] = [];
		const { handler } = setupHandler(initSelectMostCompleteContentHandler, {
			loadArticle: async () => failedArticle,
			transitionAndPersist: async (transition, params) => { expect(transition).toBe(promoteTier); results.push(transition(failedArticle, params.input).article); },
		});
		expect(await handler(event(saveDetail), buildLambdaContext(), () => {})).toEqual({ batchItemFailures: [] });
		expect(results.map((result) => result.crawl)).toEqual([{ kind: "ready" }]);
	});
});
