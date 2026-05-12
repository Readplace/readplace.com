import { noopLogger } from "@packages/hutch-logger";
import { initLinkSummariser } from "./link-summariser";
import type {
	CreateAiMessage,
	FindGeneratedSummary,
	MarkSummarySkipped,
	MarkSummaryStage,
	SaveGeneratedSummary,
} from "./article-summary.types";

function createStubCreateMessage(payload: { summary: string; excerpt: string }): CreateAiMessage {
	return async () => ({
		content: [{ type: "text", text: JSON.stringify(payload) }],
		usage: { input_tokens: 50, output_tokens: 10 },
	});
}

const noCache: FindGeneratedSummary = async () => undefined;
const pendingCache: FindGeneratedSummary = async () => ({ status: "pending" });
const noopSave: SaveGeneratedSummary = async () => {};
const noopMarkSkipped: MarkSummarySkipped = async () => {};
const noopMarkStage: MarkSummaryStage = async () => {};
const identity = (text: string) => text;

describe("initLinkSummariser", () => {
	it("should skip summarisation and mark the row as skipped when isTooShortToSummarize returns true", async () => {
		const createMessage = jest.fn();
		const markSummarySkipped = jest.fn().mockResolvedValue(undefined);

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: pendingCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => true,
		});

		const result = await summarizeArticle({
			url: "https://example.com/short",
			textContent: "Short article text.",
		});

		expect(result).toBeNull();
		expect(createMessage).not.toHaveBeenCalled();
		expect(markSummarySkipped).toHaveBeenCalledWith({
			url: "https://example.com/short",
			reason: "content-too-short",
		});
	});

	it("should pass article content as a document block to createMessage", async () => {
		const createMessage = jest.fn().mockResolvedValue({
			content: [{ type: "text", text: JSON.stringify({ summary: "A summary.", excerpt: "Blurb." }) }],
			usage: { input_tokens: 50, output_tokens: 10 },
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: noCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		await summarizeArticle({
			url: "https://example.com/article",
			textContent: "Some article content about prompt injection.",
		});

		expect(createMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [{
					role: "user",
					content: [{
						type: "document",
						source: { type: "text", media_type: "text/plain", data: "Some article content about prompt injection." },
						title: "Article to summarize",
						citations: { enabled: true },
					}],
				}],
			}),
		);
	});

	it("should call createMessage and persist both summary and excerpt", async () => {
		const createMessage = createStubCreateMessage({
			summary: "A good summary.",
			excerpt: "Quick blurb.",
		});
		const saveGeneratedSummary = jest.fn().mockResolvedValue(undefined);

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: pendingCache,
			saveGeneratedSummary,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/long",
			textContent: "A long article with lots of content.",
		});

		expect(result).toEqual({
			summary: "A good summary.",
			excerpt: "Quick blurb.",
			inputTokens: 50,
			outputTokens: 10,
		});
		expect(saveGeneratedSummary).toHaveBeenCalledWith({
			url: "https://example.com/long",
			summary: "A good summary.",
			excerpt: "Quick blurb.",
			inputTokens: 50,
			outputTokens: 10,
		});
	});

	it("should clip an over-length excerpt at the last word boundary", async () => {
		const overLong = `${"word ".repeat(60)}tail`;
		const createMessage = createStubCreateMessage({
			summary: "Body.",
			excerpt: overLong,
		});
		const saveGeneratedSummary = jest.fn().mockResolvedValue(undefined);

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: noCache,
			saveGeneratedSummary,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/long",
			textContent: "x",
		});

		expect(result?.excerpt.length).toBeLessThanOrEqual(160);
		expect(result?.excerpt.endsWith("…")).toBe(true);
		expect(saveGeneratedSummary).toHaveBeenCalledWith(
			expect.objectContaining({ excerpt: result?.excerpt }),
		);
	});

	it("should hard-cut an over-length excerpt that has no whitespace", async () => {
		const noSpaces = "x".repeat(200);
		const createMessage = createStubCreateMessage({
			summary: "Body.",
			excerpt: noSpaces,
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: noCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/no-spaces",
			textContent: "x",
		});

		expect(result?.excerpt).toBe(`${"x".repeat(159)}…`);
	});

	it("should return null on ready cache hit without calling createMessage", async () => {
		const createMessage = jest.fn();
		const cachedSummary: FindGeneratedSummary = async () => ({
			status: "ready",
			summary: "cached summary",
			excerpt: "cached excerpt",
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: cachedSummary,
			saveGeneratedSummary: noopSave,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/cached",
			textContent: "Some content.",
		});

		expect(result).toBeNull();
		expect(createMessage).not.toHaveBeenCalled();
	});

	it("should return null on skipped cache hit", async () => {
		const createMessage = jest.fn();
		const skippedCache: FindGeneratedSummary = async () => ({ status: "skipped" });

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: skippedCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/skipped",
			textContent: "Some content.",
		});

		expect(result).toBeNull();
		expect(createMessage).not.toHaveBeenCalled();
	});

	it("should retry on failed status (redrive scenario: give the new attempt a chance)", async () => {
		const createMessage = createStubCreateMessage({
			summary: "Recovered summary.",
			excerpt: "Recovered blurb.",
		});
		const failedCache: FindGeneratedSummary = async () => ({
			status: "failed",
			reason: "timeout",
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: failedCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/failed",
			textContent: "Some content.",
		});

		expect(result).toEqual({
			summary: "Recovered summary.",
			excerpt: "Recovered blurb.",
			inputTokens: 50,
			outputTokens: 10,
		});
	});

	it("should proceed when cache status is pending", async () => {
		const createMessage = createStubCreateMessage({
			summary: "Fresh summary.",
			excerpt: "Fresh blurb.",
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: pendingCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped: noopMarkSkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/pending",
			textContent: "Long content.",
		});

		expect(result).toEqual({
			summary: "Fresh summary.",
			excerpt: "Fresh blurb.",
			inputTokens: 50,
			outputTokens: 10,
		});
	});

	it("should mark the row skipped with reason ai-no-text-block when the response has no text block", async () => {
		const createMessage: CreateAiMessage = async () => ({
			content: [{ type: "tool_use" }],
			usage: { input_tokens: 50, output_tokens: 10 },
		});
		const markSummarySkipped = jest.fn().mockResolvedValue(undefined);

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: noCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/no-text-block",
			textContent: "Some article content.",
		});

		expect(result).toBeNull();
		expect(markSummarySkipped).toHaveBeenCalledWith({
			url: "https://example.com/no-text-block",
			reason: "ai-no-text-block",
		});
	});

	it("should mark the row skipped with reason ai-unavailable when AI returns 'Summary not available.'", async () => {
		const createMessage = createStubCreateMessage({
			summary: "Summary not available.",
			excerpt: "Summary not available.",
		});
		const markSummarySkipped = jest.fn().mockResolvedValue(undefined);

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			findGeneratedSummary: noCache,
			saveGeneratedSummary: noopSave,
			markSummarySkipped,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/unavailable",
			textContent: "Content that cannot be summarised.",
		});

		expect(result).toBeNull();
		expect(markSummarySkipped).toHaveBeenCalledWith({
			url: "https://example.com/unavailable",
			reason: "ai-unavailable",
		});
	});
});
