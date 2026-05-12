import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	CreateAiMessage,
	FindGeneratedSummary,
	MarkSummarySkipped,
	MarkSummaryStage,
	SaveGeneratedSummary,
	SummarizeArticle,
} from "./article-summary.types";
import { MAX_EXCERPT_LENGTH, MAX_SUMMARY_LENGTH } from "./max-summary-length";

const SUMMARIZE_PROMPT = readFileSync(
	join(__dirname, "summarize-prompt.md"),
	"utf-8",
)
	.replace("{{MAX_SUMMARY_LENGTH}}", String(MAX_SUMMARY_LENGTH))
	.replace("{{MAX_EXCERPT_LENGTH}}", String(MAX_EXCERPT_LENGTH));

const SummaryPayload = z.object({
	summary: z.string(),
	excerpt: z.string(),
});

// Safety net: if DeepSeek overshoots MAX_EXCERPT_LENGTH despite the prompt
// instruction, clip on a word boundary so we never persist a row that violates
// the contract downstream consumers rely on.
function clipExcerpt(text: string): string {
	if (text.length <= MAX_EXCERPT_LENGTH) return text;
	const slice = text.slice(0, MAX_EXCERPT_LENGTH - 1);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}

export function initLinkSummariser(deps: {
	createMessage: CreateAiMessage;
	findGeneratedSummary: FindGeneratedSummary;
	saveGeneratedSummary: SaveGeneratedSummary;
	markSummarySkipped: MarkSummarySkipped;
	markSummaryStage: MarkSummaryStage;
	logger: HutchLogger;
	cleanContent: (html: string) => string;
	isTooShortToSummarize: (cleanedText: string) => boolean;
}): { summarizeArticle: SummarizeArticle } {
	const summarizeArticle: SummarizeArticle = async (params) => {
		await deps.markSummaryStage({ url: params.url, stage: "summary-started" });
		const cached = await deps.findGeneratedSummary(params.url);
		// "failed" is retryable on redrive; "ready" and "skipped" are terminal — short-circuit those.
		if (cached?.status === "ready" || cached?.status === "skipped") {
			deps.logger.info("[summarize] cache hit", { url: params.url, status: cached.status });
			return null;
		}

		const cleanedContent = deps.cleanContent(params.textContent);
		const visibleLength = cleanedContent.replace(/\s/g, "").length;

		if (deps.isTooShortToSummarize(cleanedContent)) {
			deps.logger.info("[summarize] content too short, skipping", { url: params.url, visibleLength });
			await deps.markSummarySkipped({ url: params.url, reason: "content-too-short" });
			return null;
		}

		await deps.markSummaryStage({ url: params.url, stage: "summary-generating" });
		const response = await deps.createMessage({
			model: "deepseek-chat",
			max_tokens: 10240,
			system: SUMMARIZE_PROMPT,
			messages: [{
				role: "user",
				content: [{
					type: "document",
					source: { type: "text", media_type: "text/plain", data: cleanedContent },
					title: "Article to summarize",
					citations: { enabled: true },
				}],
			}],
			output_config: {
				format: {
					type: "json_schema",
					schema: {
						type: "object",
						properties: {
							summary: {
								type: "string",
								description: `Plain text summary, max ${MAX_SUMMARY_LENGTH} characters`,
							},
							excerpt: {
								type: "string",
								description: `One or two short sentences, max ${MAX_EXCERPT_LENGTH} characters`,
							},
						},
						required: ["summary", "excerpt"],
						additionalProperties: false,
					},
				},
			},
		});

		const textBlock = response.content.find(
			(block) => block.type === "text",
		);
		if (!textBlock || textBlock.type !== "text" || !textBlock.text) {
			deps.logger.info("[summarize] no text block in response", { url: params.url });
			await deps.markSummarySkipped({ url: params.url, reason: "ai-no-text-block" });
			return null;
		}

		const parsed = SummaryPayload.parse(JSON.parse(textBlock.text));
		const summary = parsed.summary.trim();
		if (summary === "Summary not available.") {
			deps.logger.info("[summarize] AI returned unavailable", { url: params.url });
			await deps.markSummarySkipped({ url: params.url, reason: "ai-unavailable" });
			return null;
		}
		const excerpt = clipExcerpt(parsed.excerpt.trim());

		await deps.saveGeneratedSummary({
			url: params.url,
			summary,
			excerpt,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		});
		return {
			summary,
			excerpt,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		};
	};

	return { summarizeArticle };
}
