import assert from "node:assert";
import type { CreateAiMessage, DocumentBlock } from "./create-ai-message.types";
import type { DeepseekMessage } from "./deepseek-chat.types";

export const DEEPSEEK_SPECIAL_TOKENS = {
	bos: "<｜begin▁of▁sentence｜>",
	user: "<｜User｜>",
	assistant: "<｜Assistant｜>",
	thinkingEnd: "</think>",
} as const;

export const DEEPSEEK_PROMPT_TOKEN_MARGIN = 32;

const JSON_OBJECT_RESPONSE_FORMAT_SECTION =
	'\n\n## Response Format:\n\nYou MUST strictly adhere to the following schema to reply:\n{"type": "json_object"}';

function flattenContent(content: string | Array<DocumentBlock>): string {
	if (typeof content === "string") return content;
	return content.map((block) => block.source.data).join("\n");
}

export function toDeepseekMessages(params: Parameters<CreateAiMessage>[0]): DeepseekMessage[] {
	return [
		{ role: "system", content: params.system },
		...params.messages.map((msg) => ({ ...msg, content: flattenContent(msg.content) })),
	];
}

export function encodeDeepseekChatPrompt(params: {
	system: string;
	messages: DeepseekMessage[];
	responseFormat?: { type: "json_object" };
}): string {
	assert.equal(params.messages.length, 2, "DeepSeek prompt encoding supports exactly one system and one user message");
	const [system, user] = params.messages;
	assert.equal(system.role, "system", "DeepSeek prompt encoding expects the system message first");
	assert.equal(system.content, params.system, "DeepSeek prompt encoding expects the system message to carry the system prompt");
	assert.equal(user.role, "user", "DeepSeek prompt encoding expects the user message second");
	const responseFormat = params.responseFormat ? JSON_OBJECT_RESPONSE_FORMAT_SECTION : "";
	return (
		DEEPSEEK_SPECIAL_TOKENS.bos +
		params.system +
		responseFormat +
		DEEPSEEK_SPECIAL_TOKENS.user +
		user.content +
		DEEPSEEK_SPECIAL_TOKENS.assistant +
		DEEPSEEK_SPECIAL_TOKENS.thinkingEnd
	);
}
