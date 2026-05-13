import { noopLogger } from "@packages/hutch-logger";
import { initLinkSummariser } from "./link-summariser";
import type { CreateAiMessage } from "./create-ai-message.types";
import type { MarkSummaryStage } from "./mark-summary-stage";

function createStubCreateMessage(payload: { summary: string; excerpt: string }): CreateAiMessage {
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

	it("clips excerpt on a word boundary if it exceeds MAX_EXCERPT_LENGTH", async () => {
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
		expect(result.excerpt.length).toBeLessThanOrEqual(160);
		expect(result.excerpt.endsWith("…")).toBe(true);
	});

	it("hard-cuts an over-length excerpt that has no whitespace", async () => {
		const noSpaces = "x".repeat(200);
		const createMessage = createStubCreateMessage({
			summary: "Body.",
			excerpt: noSpaces,
		});

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
		expect(result.excerpt).toBe(`${"x".repeat(159)}…`);
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
