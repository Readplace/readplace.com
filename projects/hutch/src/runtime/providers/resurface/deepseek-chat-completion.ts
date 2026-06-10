import assert from "node:assert";
import { z } from "zod";
import type { CreateChatCompletion } from "../../domain/resurface/match-articles-by-interest";

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";

/** Must fire before the hutch SSR Lambda's 30s timeout so a slow DeepSeek call
 * surfaces as a thrown error the route can turn into a graceful redirect,
 * instead of the Lambda being killed mid-request. Mirrors the save-link
 * convention of DeepSeek-client timeout < Lambda timeout. */
const DEEPSEEK_TIMEOUT_MS = 25_000;

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
	init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
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
			signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
		});
		assert(response.ok, `DeepSeek request failed with status ${response.status}`);
		return ChatCompletionResponseSchema.parse(await response.json());
	};
}
