import { initReviewDocumentWithDeepseek } from "./init-review-document-with-deepseek";

type Params = Parameters<Parameters<typeof initReviewDocumentWithDeepseek>[0]["createChatCompletion"]>[0];

describe("initReviewDocumentWithDeepseek", () => {
	it("forwards system/user messages and returns text + token counts", async () => {
		const review = initReviewDocumentWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: '{"decisions": []}' } }],
				usage: { prompt_tokens: 500, completion_tokens: 100 },
			}),
		});

		const result = await review({
			systemPrompt: "rules",
			userMessage: '{"pages": []}',
			maxTokens: 4096,
		});

		expect(result.text).toBe('{"decisions": []}');
		expect(result.tokens).toEqual({ input: 500, output: 100 });
	});

	it("uses deepseek-chat with temperature 0 and JSON response_format", async () => {
		let captured: Params | undefined;
		const review = initReviewDocumentWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return {
					choices: [{ message: { content: "{}" } }],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				};
			},
		});

		await review({ systemPrompt: "s", userMessage: "u", maxTokens: 4096 });

		expect(captured?.model).toBe("deepseek-chat");
		expect(captured?.temperature).toBe(0);
		expect(captured?.response_format).toEqual({ type: "json_object" });
	});

	it("clamps maxTokens to the DeepSeek 8192 ceiling", async () => {
		let captured: Params | undefined;
		const review = initReviewDocumentWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return { choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
			},
		});

		await review({ systemPrompt: "s", userMessage: "u", maxTokens: 100_000 });

		expect(captured?.max_tokens).toBe(8192);
	});

	it("passes through maxTokens when below the DeepSeek ceiling", async () => {
		let captured: Params | undefined;
		const review = initReviewDocumentWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return { choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
			},
		});

		await review({ systemPrompt: "s", userMessage: "u", maxTokens: 2048 });

		expect(captured?.max_tokens).toBe(2048);
	});

	it("throws when the response lacks message content", async () => {
		const review = initReviewDocumentWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: null } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		});

		await expect(
			review({ systemPrompt: "s", userMessage: "u", maxTokens: 256 }),
		).rejects.toThrow("DeepSeek response missing message content");
	});

	it("throws when the response lacks usage data", async () => {
		const review = initReviewDocumentWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: "{}" } }],
				usage: null,
			}),
		});

		await expect(
			review({ systemPrompt: "s", userMessage: "u", maxTokens: 256 }),
		).rejects.toThrow("DeepSeek response missing usage data");
	});
});
