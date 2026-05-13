import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	SELECT_CONTENT_SYSTEM_PROMPT,
	type SelectorCandidate,
	buildSelectContentUserMessage,
	labelForIndex,
} from "./select-content-prompt";
import type { Tier } from "./tier.types";

// https://api-docs.deepseek.com/quick_start/pricing — deepseek-chat max output is 8K
const DEEPSEEK_MAX_OUTPUT_TOKENS = 8192;

export type SelectMostCompleteContent = (params: {
	url: string;
	candidates: readonly SelectorCandidate[];
}) => Promise<{ winner: Tier | "tie"; reason: string }>;

type ChatCompletionResponse = {
	choices: Array<{ message?: { content?: string | null } }>;
};

export type CreateSelectorChatCompletion = (params: {
	model: string;
	max_tokens: number;
	response_format: { type: "json_object" };
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
}) => Promise<ChatCompletionResponse>;

const ResponseSchema = z.object({
	winner: z.string(),
	reason: z.string(),
});

export function initSelectMostCompleteContent(deps: {
	createChatCompletion: CreateSelectorChatCompletion;
	logger: HutchLogger;
}): { selectMostCompleteContent: SelectMostCompleteContent } {
	const { createChatCompletion, logger } = deps;

	const selectMostCompleteContent: SelectMostCompleteContent = async (params) => {
		const response = await createChatCompletion({
			model: "deepseek-chat",
			max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
			// Deepseek's JSON-mode flag — guarantees the response body is parseable
			// JSON (no prose, no fences). Shape is still validated by ResponseSchema
			// below, since json_object enforces only that the output IS json.
			// https://api-docs.deepseek.com/guides/json_mode
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: SELECT_CONTENT_SYSTEM_PROMPT },
				{ role: "user", content: buildSelectContentUserMessage(params) },
			],
		});

		const text = response.choices[0]?.message?.content?.trim();
		if (!text) {
			logger.info("[SelectContent] empty response, returning tie", { url: params.url });
			return { winner: "tie", reason: "empty response" };
		}

		const parsed = safeParseJson(text);
		if (!parsed.success) {
			logger.info("[SelectContent] malformed JSON, returning tie", { url: params.url, raw: text });
			return { winner: "tie", reason: "malformed response" };
		}

		const validated = ResponseSchema.safeParse(parsed.value);
		if (!validated.success) {
			logger.info("[SelectContent] schema mismatch, returning tie", { url: params.url, raw: text });
			return { winner: "tie", reason: "schema mismatch" };
		}

		const winnerLabel = validated.data.winner.toUpperCase();
		if (winnerLabel === "TIE") {
			return { winner: "tie", reason: validated.data.reason };
		}
		const labels = params.candidates.map((_, index) => labelForIndex(index));
		const winnerIndex = labels.indexOf(winnerLabel);
		if (winnerIndex === -1) {
			logger.info("[SelectContent] unknown winner label, returning tie", {
				url: params.url,
				winnerLabel,
			});
			return { winner: "tie", reason: "unknown winner label" };
		}
		return { winner: params.candidates[winnerIndex].tier, reason: validated.data.reason };
	};

	return { selectMostCompleteContent };
}

function safeParseJson(text: string): { success: true; value: unknown } | { success: false } {
	try {
		return { success: true, value: JSON.parse(text) };
	} catch {
		return { success: false };
	}
}
