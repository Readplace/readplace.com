import assert from "node:assert/strict";
import {
	DEEPSEEK_PROMPT_TOKEN_MARGIN,
	DEEPSEEK_SPECIAL_TOKENS,
	encodeDeepseekChatPrompt,
	toDeepseekMessages,
} from "./deepseek-chat-prompt";
import { DEEPSEEK_FEATURES } from "./deepseek-feature";

describe("DEEPSEEK_SPECIAL_TOKENS", () => {
	it("spells each token with the fullwidth bar and the lower one eighth block", () => {
		assert.deepEqual(DEEPSEEK_SPECIAL_TOKENS, {
			bos: "<｜begin▁of▁sentence｜>",
			user: "<｜User｜>",
			assistant: "<｜Assistant｜>",
			thinkingEnd: "</think>",
		});
	});
});

describe("DEEPSEEK_PROMPT_TOKEN_MARGIN", () => {
	it("adds 32 tokens to every counted prompt", () => {
		assert.equal(DEEPSEEK_PROMPT_TOKEN_MARGIN, 32);
	});
});

describe("encodeDeepseekChatPrompt", () => {
	it("renders a system and a user message in chat mode", () => {
		const prompt = encodeDeepseekChatPrompt({
			system: "Sys",
			messages: [
				{ role: "system", content: "Sys" },
				{ role: "user", content: "Hi" },
			],
		});

		assert.equal(prompt, "<｜begin▁of▁sentence｜>Sys<｜User｜>Hi<｜Assistant｜></think>");
	});

	it("matches the first turn of the official encoding fixture test_output_2.txt at revision 60d8d70770c6776ff598c94bb586a859a38244f1", () => {
		const prompt = encodeDeepseekChatPrompt({
			system: "You are a helpful assistant.",
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello" },
			],
		});

		assert.equal(prompt, "<｜begin▁of▁sentence｜>You are a helpful assistant.<｜User｜>Hello<｜Assistant｜></think>");
	});

	it("appends the json_object response format section to the system prompt", () => {
		const prompt = encodeDeepseekChatPrompt({
			system: "Sys",
			messages: [
				{ role: "system", content: "Sys" },
				{ role: "user", content: "Hi" },
			],
			responseFormat: { type: "json_object" },
		});

		assert.equal(
			prompt,
			'<｜begin▁of▁sentence｜>Sys\n\n## Response Format:\n\nYou MUST strictly adhere to the following schema to reply:\n{"type": "json_object"}<｜User｜>Hi<｜Assistant｜></think>',
		);
	});

	it("encodes document blocks flattened the way the adapter sends them", () => {
		const params = {
			feature: DEEPSEEK_FEATURES.summary,
			max_tokens: 100,
			system: "Pick related reads.",
			messages: [
				{
					role: "user" as const,
					content: [
						{
							type: "document" as const,
							source: { type: "text" as const, media_type: "text/plain" as const, data: "First" },
							title: "a",
							citations: { enabled: false },
						},
						{
							type: "document" as const,
							source: { type: "text" as const, media_type: "text/plain" as const, data: "Second" },
							title: "b",
							citations: { enabled: false },
						},
					],
				},
			],
		};

		const prompt = encodeDeepseekChatPrompt({ system: params.system, messages: toDeepseekMessages(params) });

		assert.equal(prompt, "<｜begin▁of▁sentence｜>Pick related reads.<｜User｜>First\nSecond<｜Assistant｜></think>");
	});

	it.each([
		["an assistant turn", [
			{ role: "system" as const, content: "Sys" },
			{ role: "user" as const, content: "Hi" },
			{ role: "assistant" as const, content: "Hello" },
		], "DeepSeek prompt encoding supports exactly one system and one user message"],
		["two user turns", [
			{ role: "system" as const, content: "Sys" },
			{ role: "user" as const, content: "Hi" },
			{ role: "user" as const, content: "Again" },
		], "DeepSeek prompt encoding supports exactly one system and one user message"],
		["no user turn", [
			{ role: "system" as const, content: "Sys" },
		], "DeepSeek prompt encoding supports exactly one system and one user message"],
		["the user first", [
			{ role: "user" as const, content: "Hi" },
			{ role: "system" as const, content: "Sys" },
		], "DeepSeek prompt encoding expects the system message first"],
		["an assistant turn in place of the user", [
			{ role: "system" as const, content: "Sys" },
			{ role: "assistant" as const, content: "Hello" },
		], "DeepSeek prompt encoding expects the user message second"],
		["a system message that is not the system prompt", [
			{ role: "system" as const, content: "Other" },
			{ role: "user" as const, content: "Hi" },
		], "DeepSeek prompt encoding expects the system message to carry the system prompt"],
	])("refuses %s", (_shape, messages, message) => {
		assert.throws(() => encodeDeepseekChatPrompt({ system: "Sys", messages }), { message });
	});
});
