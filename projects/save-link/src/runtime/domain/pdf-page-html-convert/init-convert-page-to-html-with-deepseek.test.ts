import { initConvertPageToHtmlWithDeepseek } from "./init-convert-page-to-html-with-deepseek";

type Params = Parameters<Parameters<typeof initConvertPageToHtmlWithDeepseek>[0]["createChatCompletion"]>[0];

describe("initConvertPageToHtmlWithDeepseek", () => {
	it("forwards systemPrompt + userText as system/user messages and returns text + token counts", async () => {
		const convert = initConvertPageToHtmlWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: "<h2>Title</h2><p>body</p>" } }],
				usage: { prompt_tokens: 200, completion_tokens: 60 },
			}),
		});

		const result = await convert({
			systemPrompt: "rules",
			userText: "Title\n\nbody",
			maxTokens: 512,
		});

		expect(result).toEqual({
			text: "<h2>Title</h2><p>body</p>",
			tokens: { input: 200, output: 60 },
		});
	});

	it("uses deepseek-chat with temperature 0 and no response_format", async () => {
		let captured: Params | undefined;
		const convert = initConvertPageToHtmlWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return { choices: [{ message: { content: "<p>x</p>" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
			},
		});

		await convert({ systemPrompt: "s", userText: "u", maxTokens: 1024 });

		expect(captured?.model).toBe("deepseek-chat");
		expect(captured?.temperature).toBe(0);
		expect("response_format" in (captured ?? {})).toBe(false);
	});

	it("clamps maxTokens to the DeepSeek 8192 ceiling", async () => {
		let captured: Params | undefined;
		const convert = initConvertPageToHtmlWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return { choices: [{ message: { content: "<p>x</p>" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
			},
		});

		await convert({ systemPrompt: "s", userText: "u", maxTokens: 99_999 });

		expect(captured?.max_tokens).toBe(8192);
	});

	it("passes through maxTokens when below the DeepSeek ceiling", async () => {
		let captured: Params | undefined;
		const convert = initConvertPageToHtmlWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return { choices: [{ message: { content: "<p>x</p>" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
			},
		});

		await convert({ systemPrompt: "s", userText: "u", maxTokens: 2048 });

		expect(captured?.max_tokens).toBe(2048);
	});

	it("throws when the response lacks message content", async () => {
		const convert = initConvertPageToHtmlWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: null } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		});

		await expect(convert({ systemPrompt: "s", userText: "u", maxTokens: 256 })).rejects.toThrow("DeepSeek response missing message content");
	});

	it("throws when the response lacks usage data", async () => {
		const convert = initConvertPageToHtmlWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: "<p>x</p>" } }],
				usage: null,
			}),
		});

		await expect(convert({ systemPrompt: "s", userText: "u", maxTokens: 256 })).rejects.toThrow("DeepSeek response missing usage data");
	});

	it("returns an empty-string content as valid (model emitted nothing)", async () => {
		// The handler's guardrail will reject an empty output; the adapter
		// must surface "" rather than treat it as a missing-content error so
		// the handler can route it through the paragraph fallback.
		const convert = initConvertPageToHtmlWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: "" } }],
				usage: { prompt_tokens: 1, completion_tokens: 0 },
			}),
		});
		const result = await convert({ systemPrompt: "s", userText: "u", maxTokens: 256 });
		expect(result.text).toBe("");
	});
});
