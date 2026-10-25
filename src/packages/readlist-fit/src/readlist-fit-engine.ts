import {
	type CreateAiMessage,
	DEEPSEEK_MODEL,
	DEEPSEEK_THINKING_MODEL,
	initCreateDeepseekMessage,
	initCreateDeepseekThinkingMessage,
} from "@packages/ai-message";
import { z } from "zod";

export const ReadlistFitEngineSchema = z.enum(["deepseek-flash", "deepseek-v4-pro-thinking"]);
export type ReadlistFitEngine = z.infer<typeof ReadlistFitEngineSchema>;

type CreateChatCompletion = Parameters<typeof initCreateDeepseekMessage>[0]["createChatCompletion"];

export const READLIST_FIT_ENGINES: Record<
	ReadlistFitEngine,
	{ init: (deps: { createChatCompletion: CreateChatCompletion }) => CreateAiMessage; model: string }
> = {
	"deepseek-flash": { init: initCreateDeepseekMessage, model: DEEPSEEK_MODEL },
	"deepseek-v4-pro-thinking": { init: initCreateDeepseekThinkingMessage, model: DEEPSEEK_THINKING_MODEL },
};

export function createAiMessageForEngine(input: {
	engine: ReadlistFitEngine;
	createChatCompletion: CreateChatCompletion;
}): CreateAiMessage {
	return READLIST_FIT_ENGINES[input.engine].init({ createChatCompletion: input.createChatCompletion });
}
