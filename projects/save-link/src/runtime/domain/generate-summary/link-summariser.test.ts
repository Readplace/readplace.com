import { noopLogger } from "@packages/hutch-logger";
import { MAX_EXCERPT_LENGTH } from "@packages/provider-contracts/article-summary";
import { initLinkSummariser } from "./link-summariser";
import type { CreateAiMessage } from "@packages/ai-message";
import type { MarkSummaryStage } from "../../providers/article-crawl/mark-summary-stage";

function createStubCreateMessage(payload: { summary: string; excerpt?: string }): CreateAiMessage {
	return async () => ({
		content: [{ type: "text", text: JSON.stringify(payload) }],
		usage: { input_tokens: 50, output_tokens: 10 },
	});
}

const noopMarkStage: MarkSummaryStage = async () => {};
const identity = (text: string) => text;

describe("initLinkSummariser", () => {
	it("returns kind 'ready' with summary/excerpt/inputTokens/outputTokens on the happy path", async () => {
		const createMessage = createStubCreateMessage({
			summary: "A good summary.",
			excerpt: "Quick blurb.",
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
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
			kind: "ready",
			summary: "A good summary.",
			excerpt: "Quick blurb.",
			inputTokens: 50,
			outputTokens: 10,
		});
	});

	it("returns kind 'skipped' with reason='content-too-short' when content is below the threshold", async () => {
		const createMessage = jest.fn();

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => true,
		});

		const result = await summarizeArticle({
			url: "https://example.com/short",
			textContent: "Short article text.",
		});

		expect(result).toEqual({ kind: "skipped", reason: "content-too-short" });
		expect(createMessage).not.toHaveBeenCalled();
	});

	it("returns kind 'skipped' with reason='ai-unavailable' when DeepSeek returns 'Summary not available.'", async () => {
		const createMessage = createStubCreateMessage({
			summary: "Summary not available.",
			excerpt: "Summary not available.",
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/unavailable",
			textContent: "Content that cannot be summarised.",
		});

		expect(result).toEqual({ kind: "skipped", reason: "ai-unavailable" });
	});

	it("returns kind 'no-text-block' when the response has no text block", async () => {
		const createMessage: CreateAiMessage = async () => ({
			content: [{ type: "tool_use" }],
			usage: { input_tokens: 50, output_tokens: 10 },
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/no-text-block",
			textContent: "Some article content.",
		});

		expect(result).toEqual({ kind: "no-text-block" });
	});

	it("calls markSummaryStage('summary-started') before any AI call", async () => {
		const createMessage = createStubCreateMessage({
			summary: "A summary.",
			excerpt: "A blurb.",
		});
		const order: string[] = [];
		const markSummaryStage: MarkSummaryStage = async ({ stage }) => {
			order.push(`stage:${stage}`);
		};
		const wrappedCreateMessage: CreateAiMessage = async (params) => {
			order.push("createMessage");
			return createMessage(params);
		};

		const { summarizeArticle } = initLinkSummariser({
			createMessage: wrappedCreateMessage,
			markSummaryStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		await summarizeArticle({
			url: "https://example.com/x",
			textContent: "Long content.",
		});

		expect(order[0]).toBe("stage:summary-started");
	});

	it("calls markSummaryStage('summary-generating') after the length check but before the AI call", async () => {
		const createMessage = createStubCreateMessage({
			summary: "A summary.",
			excerpt: "A blurb.",
		});
		const order: string[] = [];
		const markSummaryStage: MarkSummaryStage = async ({ stage }) => {
			order.push(`stage:${stage}`);
		};
		const wrappedCreateMessage: CreateAiMessage = async (params) => {
			order.push("createMessage");
			return createMessage(params);
		};

		const { summarizeArticle } = initLinkSummariser({
			createMessage: wrappedCreateMessage,
			markSummaryStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		await summarizeArticle({
			url: "https://example.com/x",
			textContent: "Long content.",
		});

		expect(order).toEqual([
			"stage:summary-started",
			"stage:summary-generating",
			"createMessage",
		]);
	});

	it("keeps a model-written excerpt whole past MAX_EXCERPT_LENGTH, so the reader's teaser is never cut mid-sentence", async () => {
		const overLong = `${"word ".repeat(60)}tail`;
		const createMessage = createStubCreateMessage({
			summary: "Body.",
			excerpt: overLong,
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/long",
			textContent: "x",
		});

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") throw new Error("unreachable");
		expect(overLong.length).toBeGreaterThan(MAX_EXCERPT_LENGTH);
		expect(result.excerpt).toBe(overLong);
	});

	it("derives the excerpt from the summary when the model omits it, instead of discarding the whole result", async () => {
		const createMessage = createStubCreateMessage({ summary: "A good summary." });
		const info = jest.fn();

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: { ...noopLogger, info },
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/no-excerpt",
			textContent: "A long article with lots of content.",
		});

		expect(result).toEqual({
			kind: "ready",
			summary: "A good summary.",
			excerpt: "A good summary.",
			inputTokens: 50,
			outputTokens: 10,
		});
		expect(info).toHaveBeenCalledWith(
			"[summarize] no excerpt in response, deriving one from the summary",
			{ url: "https://example.com/no-excerpt" },
		);
	});

	it("derives the excerpt when the model returns a blank one, which would otherwise persist as an empty excerpt", async () => {
		const createMessage = createStubCreateMessage({ summary: "A good summary.", excerpt: "   " });

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/blank-excerpt",
			textContent: "A long article with lots of content.",
		});

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") throw new Error("unreachable");
		expect(result.excerpt).toBe("A good summary.");
	});

	it("substitutes every prompt placeholder, including the second MAX_EXCERPT_LENGTH the excerpt rule repeats", async () => {
		const createMessage = jest.fn(createStubCreateMessage({ summary: "S.", excerpt: "E." }));

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		await summarizeArticle({ url: "https://example.com/x", textContent: "Long content." });

		const { system } = createMessage.mock.calls[0][0];
		expect(system).not.toMatch(/\{\{[A-Z_]+\}\}/u);
		expect(system).toContain(`Do not exceed ${MAX_EXCERPT_LENGTH} characters under any circumstances.`);
	});

	it("flattens paragraph breaks out of a derived excerpt, which must be a single blurb", async () => {
		const createMessage = createStubCreateMessage({ summary: "First point.\n\nSecond point." });

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/paragraphs",
			textContent: "x",
		});

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") throw new Error("unreachable");
		expect(result.summary).toBe("First point.\n\nSecond point.");
		expect(result.excerpt).toBe("First point. Second point.");
	});

	it("clips a derived excerpt to MAX_EXCERPT_LENGTH so an over-long summary cannot violate the contract", async () => {
		const createMessage = createStubCreateMessage({ summary: `${"word ".repeat(60)}tail` });


		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/no-excerpt-long",
			textContent: "x",
		});

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") throw new Error("unreachable");
		expect(result.excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH);
		expect(result.excerpt.endsWith("…")).toBe(true);
	});

	it("hard-cuts a derived excerpt whose summary has no whitespace to cut on", async () => {
		const noSpaces = "x".repeat(200);
		const createMessage = createStubCreateMessage({ summary: noSpaces });

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
			markSummaryStage: noopMarkStage,
			logger: noopLogger,
			cleanContent: identity,
			isTooShortToSummarize: () => false,
		});

		const result = await summarizeArticle({
			url: "https://example.com/no-spaces",
			textContent: "x",
		});

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") throw new Error("unreachable");
		expect(result.excerpt).toBe(`${"x".repeat(MAX_EXCERPT_LENGTH - 1)}…`);
	});

	it("passes article content as a document block to createMessage", async () => {
		const createMessage = jest.fn().mockResolvedValue({
			content: [{ type: "text", text: JSON.stringify({ summary: "A summary.", excerpt: "Blurb." }) }],
			usage: { input_tokens: 50, output_tokens: 10 },
		});

		const { summarizeArticle } = initLinkSummariser({
			createMessage,
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
});
