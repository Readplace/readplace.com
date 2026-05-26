import { initCleanupPageWithDeepseek } from "./init-cleanup-page-with-deepseek";

type Params = Parameters<Parameters<typeof initCleanupPageWithDeepseek>[0]["createChatCompletion"]>[0];

describe("initCleanupPageWithDeepseek", () => {
	it("forwards systemPrompt + userText as system/user messages and returns text + token counts", async () => {
		const cleanup = initCleanupPageWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: "Repository of the Reading Room." } }],
				usage: { prompt_tokens: 120, completion_tokens: 30 },
			}),
		});

		const result = await cleanup({
			systemPrompt: "system rules",
			userText: "Vepository of the Reading Room.",
			maxTokens: 256,
		});

		expect(result).toEqual({
			text: "Repository of the Reading Room.",
			tokens: { input: 120, output: 30 },
		});
	});

	it("uses deepseek-chat with temperature 0", async () => {
		let captured: Params | undefined;
		const cleanup = initCleanupPageWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return {
					choices: [{ message: { content: "x" } }],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				};
			},
		});

		await cleanup({ systemPrompt: "sys", userText: "u", maxTokens: 256 });

		expect(captured?.model).toBe("deepseek-chat");
		expect(captured?.temperature).toBe(0);
		expect(captured?.messages).toEqual([
			{ role: "system", content: "sys" },
			{ role: "user", content: "u" },
		]);
	});

	it("clamps maxTokens to the DeepSeek 8192 ceiling", async () => {
		let captured: Params | undefined;
		const cleanup = initCleanupPageWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return {
					choices: [{ message: { content: "x" } }],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				};
			},
		});

		await cleanup({ systemPrompt: "sys", userText: "u", maxTokens: 99_999 });

		expect(captured?.max_tokens).toBe(8192);
	});

	it("passes through maxTokens when below the DeepSeek ceiling", async () => {
		let captured: Params | undefined;
		const cleanup = initCleanupPageWithDeepseek({
			createChatCompletion: async (params) => {
				captured = params;
				return {
					choices: [{ message: { content: "x" } }],
					usage: { prompt_tokens: 1, completion_tokens: 1 },
				};
			},
		});

		await cleanup({ systemPrompt: "sys", userText: "u", maxTokens: 1024 });

		expect(captured?.max_tokens).toBe(1024);
	});

	it("throws when the response lacks message content", async () => {
		const cleanup = initCleanupPageWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: null } }],
				usage: { prompt_tokens: 1, completion_tokens: 1 },
			}),
		});

		await expect(
			cleanup({ systemPrompt: "sys", userText: "u", maxTokens: 256 }),
		).rejects.toThrow("DeepSeek response missing message content");
	});

	it("throws when the response lacks usage data", async () => {
		const cleanup = initCleanupPageWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: "x" } }],
				usage: null,
			}),
		});

		await expect(
			cleanup({ systemPrompt: "sys", userText: "u", maxTokens: 256 }),
		).rejects.toThrow("DeepSeek response missing usage data");
	});

	it("returns an empty string content as a valid response (model emitted no corrections)", async () => {
		// An empty cleaned-text response is structurally valid — the upstream
		// guardrails decide whether to accept it. The adapter must not reject
		// `""` as missing content; only `undefined`/`null` mean the SDK or model
		// failed to populate the field.
		const cleanup = initCleanupPageWithDeepseek({
			createChatCompletion: async () => ({
				choices: [{ message: { content: "" } }],
				usage: { prompt_tokens: 1, completion_tokens: 0 },
			}),
		});

		const result = await cleanup({ systemPrompt: "sys", userText: "u", maxTokens: 256 });
		expect(result.text).toBe("");
	});
});
