import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CreateAiMessage } from "@packages/ai-message";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	RelatedArticleLink,
	RelatedCandidate,
} from "@packages/provider-contracts/related-articles";
import { z } from "zod";
import {
	RELATED_CANDIDATE_TEXT_MAX_CHARS,
	RELATED_MAX_OUTPUT_TOKENS,
	RELATED_REASON_MAX_CHARS,
	RELATED_RESULTS_MAX,
} from "./related-articles-limits";

const RELATED_ARTICLES_PROMPT = readFileSync(
	join(__dirname, "related-articles-prompt.md"),
	"utf-8",
)
	.replace("{{RELATED_RESULTS_MAX}}", String(RELATED_RESULTS_MAX))
	.replace("{{RELATED_REASON_MAX_CHARS}}", String(RELATED_REASON_MAX_CHARS));

const RelatedPayload = z.object({
	related: z.array(
		z.object({
			index: z.number().int(),
			reason: z.string(),
		}),
	),
});

export interface RelatedArticleTarget {
	title: string;
	siteName: string;
	description: string;
}

export type SelectRelatedResult =
	| {
			kind: "ready";
			related: RelatedArticleLink[];
			inputTokens: number;
			outputTokens: number;
		}
	| { kind: "no-text-block" }
	| { kind: "shared-boilerplate" };

export interface SelectRelatedArticlesParams {
	target: RelatedArticleTarget;
	unreadCandidates: readonly RelatedCandidate[];
	readCandidates: readonly RelatedCandidate[];
}

export type SelectRelatedArticles = (
	params: SelectRelatedArticlesParams,
) => Promise<SelectRelatedResult>;

const CANDIDATE_SECTIONS = [
	{ header: "UNREAD CANDIDATES", pool: "unreadCandidates" },
	{ header: "PAST READS", pool: "readCandidates" },
] as const;

function clip(text: string, maxLength: number): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) return collapsed;
	const slice = collapsed.slice(0, maxLength - 1);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}…`;
}

function describe(article: RelatedArticleTarget): string {
	return [
		`Title: ${clip(article.title, RELATED_CANDIDATE_TEXT_MAX_CHARS)}`,
		`Site: ${clip(article.siteName, RELATED_CANDIDATE_TEXT_MAX_CHARS)}`,
		`About: ${clip(article.description, RELATED_CANDIDATE_TEXT_MAX_CHARS)}`,
	].join("\n");
}

function orderedCandidates(
	params: SelectRelatedArticlesParams,
): readonly RelatedCandidate[] {
	return CANDIDATE_SECTIONS.flatMap((section) => [...params[section.pool]]);
}

function buildRelatedArticlesMessage(params: SelectRelatedArticlesParams): string {
	const lines: string[] = ["SAVED ARTICLE", describe(params.target)];
	let index = 0;
	for (const section of CANDIDATE_SECTIONS) {
		const candidates = params[section.pool];
		if (candidates.length === 0) continue;
		lines.push("", section.header);
		for (const candidate of candidates) {
			lines.push(`[${index}]\n${describe(candidate)}`);
			index += 1;
		}
	}
	lines.push("", "SAVED ARTICLE (again)", describe(params.target));
	return lines.join("\n");
}

function selectValidRelations(params: {
	entries: readonly { index: number; reason: string }[];
	candidates: readonly RelatedCandidate[];
}): RelatedArticleLink[] {
	const seen = new Set<number>();
	const related: RelatedArticleLink[] = [];
	for (const entry of params.entries) {
		if (related.length >= RELATED_RESULTS_MAX) break;
		const candidate = params.candidates[entry.index];
		if (!candidate) continue;
		if (seen.has(entry.index)) continue;
		seen.add(entry.index);
		related.push({
			url: candidate.url,
			reason: clip(entry.reason, RELATED_REASON_MAX_CHARS),
		});
	}
	return related;
}

export function initSelectRelatedArticles(deps: {
	createMessage: CreateAiMessage;
	logger: HutchLogger;
}): { selectRelatedArticles: SelectRelatedArticles } {
	const selectRelatedArticles: SelectRelatedArticles = async (params) => {
		const response = await deps.createMessage({
			max_tokens: RELATED_MAX_OUTPUT_TOKENS,
			system: RELATED_ARTICLES_PROMPT,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "document",
							source: {
								type: "text",
								media_type: "text/plain",
								data: buildRelatedArticlesMessage(params),
							},
							title: "Saved article and candidate earlier saves",
							citations: { enabled: false },
						},
					],
				},
			],
			output_config: {
				format: {
					type: "json_schema",
					schema: {
						type: "object",
						properties: {
							related: {
								type: "array",
								maxItems: RELATED_RESULTS_MAX,
								items: {
									type: "object",
									properties: {
										index: {
											type: "integer",
											description: "The candidate number from the list",
										},
										reason: {
											type: "string",
											description: `One short sentence, max ${RELATED_REASON_MAX_CHARS} characters`,
										},
									},
									required: ["index", "reason"],
									additionalProperties: false,
								},
							},
						},
						required: ["related"],
						additionalProperties: false,
					},
				},
			},
		});

		const textBlock = response.content.find((block) => block.type === "text");
		if (textBlock?.type !== "text" || !textBlock.text) {
			deps.logger.info("[related-articles] no text block in response");
			return { kind: "no-text-block" };
		}

		const parsed = RelatedPayload.parse(JSON.parse(textBlock.text));
		return {
			kind: "ready",
			related: selectValidRelations({
				entries: parsed.related,
				candidates: orderedCandidates(params),
			}),
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		};
	};

	return { selectRelatedArticles };
}
