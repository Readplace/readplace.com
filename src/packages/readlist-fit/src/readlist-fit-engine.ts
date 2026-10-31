import {
	type CreateAiMessage,
	DEEPSEEK_MODEL,
	type DeepseekClient,
	DEEPSEEK_THINKING_MODEL,
	initCreateDeepseekMessage,
	initCreateDeepseekThinkingMessage,
} from "@packages/ai-message";
import { z } from "zod";

export const ReadlistFitEngineSchema = z.enum(["deepseek-flash", "deepseek-v4-pro-thinking"]);
export type ReadlistFitEngine = z.infer<typeof ReadlistFitEngineSchema>;

export const READLIST_FIT_ENGINES: Record<
	ReadlistFitEngine,
	{ init: (deps: { client: DeepseekClient }) => CreateAiMessage; model: string }
> = {
	"deepseek-flash": { init: initCreateDeepseekMessage, model: DEEPSEEK_MODEL },
	"deepseek-v4-pro-thinking": { init: initCreateDeepseekThinkingMessage, model: DEEPSEEK_THINKING_MODEL },
};

export function createAiMessageForEngine(input: {
	engine: ReadlistFitEngine;
	client: DeepseekClient;
}): CreateAiMessage {
	return READLIST_FIT_ENGINES[input.engine].init({ client: input.client });
}
