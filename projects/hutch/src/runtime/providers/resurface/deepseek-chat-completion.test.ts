import assert from "node:assert/strict";
import { initDeepseekChatCompletion } from "./deepseek-chat-completion";

const params = {
	model: "deepseek-chat",
	max_tokens: 10,
	temperature: 0,
	response_format: { type: "json_object" as const },
	messages: [{ role: "user" as const, content: "hi" }],
};

describe("initDeepseekChatCompletion", () => {
	it("posts the params to DeepSeek with bearer auth and returns the parsed body", async () => {
		const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
		const createChatCompletion = initDeepseekChatCompletion({
			apiKey: "sk-test",
			fetch: async (url, init) => {
				requests.push({ url, headers: init.headers, body: init.body });
				return {
					ok: true,
					status: 200,
					json: async () => ({ choices: [{ message: { content: '{"matches":[1]}' } }] }),
				};
			},
		});

		const result = await createChatCompletion(params);

		assert.equal(result.choices[0]?.message?.content, '{"matches":[1]}');
		assert.equal(requests.length, 1);
		assert.equal(requests[0].url, "https://api.deepseek.com/chat/completions");
		assert.equal(requests[0].headers.authorization, "Bearer sk-test");
		assert.match(requests[0].body, /deepseek-chat/);
	});

	it("throws when DeepSeek responds with a non-2xx status", async () => {
		const createChatCompletion = initDeepseekChatCompletion({
			apiKey: "sk-test",
			fetch: async () => ({ ok: false, status: 429, json: async () => ({}) }),
		});

		await assert.rejects(() => createChatCompletion(params), /status 429/);
	});
});
