import assert from "node:assert";
import { z } from "zod";
import type { CreateChatCompletion } from "../../domain/resurface/match-articles-by-interest";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

/** Minimal view of the chat-completions response — only the message text is
 * read downstream. `content` is `.nullish()` because some completions carry a
 * null content; `message` is merely optional to match the matcher's port. */
const ChatCompletionResponseSchema = z.object({
	choices: z.array(
		z.object({
			message: z.object({ content: z.string().nullish() }).optional(),
		}),
	),
});

type FetchResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

type FetchLike = (
	url: string,
	init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponse>;

/** Wraps DeepSeek's OpenAI-compatible `/chat/completions` endpoint as a
 * `CreateChatCompletion`. `fetch` is injected so the request shaping and the
 * non-2xx guard stay unit-testable without a live API key. */
export function initDeepseekChatCompletion(deps: {
	apiKey: string;
	fetch: FetchLike;
}): CreateChatCompletion {
	return async (params) => {
		const response = await deps.fetch(DEEPSEEK_CHAT_COMPLETIONS_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${deps.apiKey}`,
			},
			body: JSON.stringify(params),
		});
		assert(response.ok, `DeepSeek request failed with status ${response.status}`);
		return ChatCompletionResponseSchema.parse(await response.json());
	};
}
