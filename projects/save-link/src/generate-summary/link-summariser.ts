import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { SummarySkipReason } from "@packages/article-state-types";
import type { HutchLogger } from "@packages/hutch-logger";
import type { CreateAiMessage } from "./create-ai-message.types";
import type { MarkSummaryStage } from "./article-summary.types";
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

export type SummarizeResult =
	| {
			kind: "ready";
			summary: string;
			excerpt: string;
			inputTokens: number;
			outputTokens: number;
	  }
	| { kind: "skipped"; reason: SummarySkipReason }
	| { kind: "no-text-block" };

export type SummarizeArticle = (params: {
	url: string;
	textContent: string;
}) => Promise<SummarizeResult>;

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
	markSummaryStage: MarkSummaryStage;
	logger: HutchLogger;
	cleanContent: (html: string) => string;
	isTooShortToSummarize: (cleanedText: string) => boolean;
}): { summarizeArticle: SummarizeArticle } {
	const summarizeArticle: SummarizeArticle = async (params) => {
		await deps.markSummaryStage({ url: params.url, stage: "summary-started" });

		const cleanedContent = deps.cleanContent(params.textContent);
		const visibleLength = cleanedContent.replace(/\s/g, "").length;

		if (deps.isTooShortToSummarize(cleanedContent)) {
			deps.logger.info("[summarize] content too short, skipping", { url: params.url, visibleLength });
			return { kind: "skipped", reason: "content-too-short" };
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
			return { kind: "no-text-block" };
		}

		const parsed = SummaryPayload.parse(JSON.parse(textBlock.text));
		const summary = parsed.summary.trim();
		if (summary === "Summary not available.") {
			deps.logger.info("[summarize] AI returned unavailable", { url: params.url });
			return { kind: "skipped", reason: "ai-unavailable" };
		}
		const excerpt = clipExcerpt(parsed.excerpt.trim());

		return {
			kind: "ready",
			summary,
			excerpt,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		};
	};

	return { summarizeArticle };
}
