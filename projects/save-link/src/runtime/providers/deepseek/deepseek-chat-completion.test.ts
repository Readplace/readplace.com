import type { ClientOptions } from "openai";
import { noopLogger } from "@packages/hutch-logger";
import { type DeepseekChatClient, initDeepseekChatCompletion } from "./deepseek-chat-completion";

type CreateParams = Parameters<DeepseekChatClient["chat"]["completions"]["create"]>;

const params: CreateParams[0] = {
	model: "deepseek-v4-flash",
	max_tokens: 100,
	thinking: { type: "disabled" },
	messages: [{ role: "user", content: "hello" }],
};

const response = { choices: [{ message: { content: "answer" } }], usage: null };

describe("initDeepseekChatCompletion", () => {
	it("builds the client with maxRetries 0, the DeepSeek base URL, the caller's timeout and the caller's logger at info level", () => {
		const built: ClientOptions[] = [];
		initDeepseekChatCompletion({
			apiKey: "key-1",
			timeoutMs: 240_000,
			logger: noopLogger,
			newClient: (options) => {
				built.push(options);
				return { chat: { completions: { create: async () => response } } };
			},
		});

		expect(built).toEqual([
			{
				apiKey: "key-1",
				baseURL: "https://api.deepseek.com",
				timeout: 240_000,
				maxRetries: 0,
				logger: noopLogger,
				logLevel: "info",
			},
		]);
	});

	it("passes the params and a live AbortSignal to create() and returns its response", async () => {
		const calls: CreateParams[] = [];
		const { createChatCompletion } = initDeepseekChatCompletion({
			apiKey: "key-1",
			timeoutMs: 240_000,
			logger: noopLogger,
			newClient: () => ({
				chat: {
					completions: {
						create: async (...args) => {
							calls.push(args);
							return response;
						},
					},
				},
			}),
		});

		const result = await createChatCompletion(params);

		expect(result).toBe(response);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.[0]).toBe(params);
		const signal = calls[0]?.[1].signal;
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(signal?.aborted).toBe(false);
	});

	it("aborts the signal once timeoutMs has elapsed", async () => {
		const signals: AbortSignal[] = [];
		const { createChatCompletion } = initDeepseekChatCompletion({
			apiKey: "key-1",
			timeoutMs: 5,
			logger: noopLogger,
			newClient: () => ({
				chat: {
					completions: {
						create: (_params, options) => {
							signals.push(options.signal);
							return new Promise((resolve) => {
								options.signal.addEventListener("abort", () => resolve(response));
							});
						},
					},
				},
			}),
		});

		await createChatCompletion(params);

		expect(signals[0]?.aborted).toBe(true);
	});
});
