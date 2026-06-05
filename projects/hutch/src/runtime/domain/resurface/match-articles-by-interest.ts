import assert from "node:assert";
import { z } from "zod";
import type {
	MatchArticlesByInterest,
	ResurfaceCandidate,
} from "@packages/provider-contracts/resurface";

/** The slice of the OpenAI-compatible chat-completions API the matcher needs.
 * DeepSeek speaks the same protocol, so the provider that wraps `fetch`
 * structurally satisfies this port. */
export type CreateChatCompletion = (params: {
	model: string;
	max_tokens: number;
	temperature: number;
	response_format: { type: "json_object" };
	messages: Array<{ role: "system" | "user"; content: string }>;
}) => Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;

const DEEPSEEK_MODEL = "deepseek-chat";
const MAX_OUTPUT_TOKENS = 1024;
const CANDIDATE_TEXT_MAX_CHARS = 280;

const MatchResponseSchema = z.object({
	matches: z.array(z.number().int()),
});

const SYSTEM_PROMPT = [
	"You curate a reader's list of saved articles.",
	"You are given the reader's stated interest and a numbered list of their saved articles (number, title, summary).",
	'Reply with a JSON object {"matches": number[]} listing the numbers of the articles that genuinely match the interest, ordered from most to least relevant.',
	"Only include clear matches. If nothing matches, return an empty array.",
].join(" ");

function renderCandidate(candidate: ResurfaceCandidate, index: number): string {
	return `${index + 1}. ${candidate.title} — ${candidate.text.slice(0, CANDIDATE_TEXT_MAX_CHARS)}`;
}

/** DeepSeek-backed implementation of the resurface matcher. The candidates are
 * presented as a numbered list; DeepSeek returns the 1-based numbers it judges
 * relevant, which we map back to article ids (deduplicated, order preserved,
 * out-of-range numbers dropped). */
export function initMatchArticlesByInterest(deps: {
	createChatCompletion: CreateChatCompletion;
}): MatchArticlesByInterest {
	return async ({ prompt, candidates }) => {
		if (candidates.length === 0) return { matchedIds: [] };

		const list = candidates.map(renderCandidate).join("\n");
		const response = await deps.createChatCompletion({
			model: DEEPSEEK_MODEL,
			max_tokens: MAX_OUTPUT_TOKENS,
			temperature: 0,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: `Reader's interest: ${prompt}\n\nArticles:\n${list}` },
			],
		});

		const content = response.choices[0]?.message?.content?.trim();
		assert(content, "DeepSeek response missing message content");
		const { matches } = MatchResponseSchema.parse(JSON.parse(content));

		const seen = new Set<string>();
		const matchedIds: string[] = [];
		for (const oneBased of matches) {
			const candidate = candidates[oneBased - 1];
			if (candidate && !seen.has(candidate.id)) {
				seen.add(candidate.id);
				matchedIds.push(candidate.id);
			}
		}
		return { matchedIds };
	};
}
