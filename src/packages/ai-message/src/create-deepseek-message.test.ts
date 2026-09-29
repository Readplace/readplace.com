import {
	initCreateDeepseekMessage,
	initCreateDeepseekThinkingMessage,
} from "./create-deepseek-message";

describe("initCreateDeepseekMessage", () => {
	it("should prepend system message and pass JSON content through unchanged", async () => {
		const jsonPayload = JSON.stringify({
			summary: "Article explains quantum computing basics",
			excerpt: "Quick primer on qubits.",
		});
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: jsonPayload } }],
			usage: { prompt_tokens: 50, completion_tokens: 20, prompt_cache_hit_tokens: 32, prompt_cache_miss_tokens: 18 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		const result = await createMessage({
			max_tokens: 1024,
			system: "You are a summarizer.",
			messages: [{ role: "user", content: "Summarize this article" }],
		});

		expect(createChatCompletion).toHaveBeenCalledWith({
			model: "deepseek-flash",
			thinking: { type: "disabled" },
			max_tokens: 1024,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "You are a summarizer." },
				{ role: "user", content: "Summarize this article" },
			],
		});
		expect(result).toEqual({
			content: [{ type: "text", text: jsonPayload }],
			usage: {
				input_tokens: 50,
				output_tokens: 20,
				cache_hit_input_tokens: 32,
				cache_miss_input_tokens: 18,
			},
		});
	});

	it("should trim whitespace from response content", async () => {
		const jsonPayload = JSON.stringify({ summary: "trimmed", excerpt: "blurb" });
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: `  ${jsonPayload}  \n` } }],
			usage: { prompt_tokens: 5, completion_tokens: 3, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 5 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		const result = await createMessage({
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(result.content[0].text).toBe(jsonPayload);
	});

	it("should throw when response has no message content", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: null } }],
			usage: { prompt_tokens: 10, completion_tokens: 0, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });

		await expect(createMessage({
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		})).rejects.toThrow("DeepSeek response missing message content");
	});

	it("should extract text from document content blocks", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"summary":"s","excerpt":"e"}' } }],
			usage: { prompt_tokens: 60, completion_tokens: 15, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 60 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		await createMessage({
			max_tokens: 1024,
			system: "You are a summarizer.",
			messages: [{
				role: "user",
				content: [{
					type: "document",
					source: { type: "text", media_type: "text/plain", data: "Article text about quantum computing" },
					title: "Article to summarize",
					citations: { enabled: true },
				}],
			}],
		});

		expect(createChatCompletion).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: "system", content: "You are a summarizer." },
					{ role: "user", content: "Article text about quantum computing" },
				],
			}),
		);
	});

	it("should join multiple document blocks with newline", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"summary":"s","excerpt":"e"}' } }],
			usage: { prompt_tokens: 80, completion_tokens: 10, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 80 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		await createMessage({
			max_tokens: 1024,
			system: "You are a summarizer.",
			messages: [{
				role: "user",
				content: [
					{
						type: "document",
						source: { type: "text", media_type: "text/plain", data: "First section of the article" },
						title: "Part 1",
						citations: { enabled: true },
					},
					{
						type: "document",
						source: { type: "text", media_type: "text/plain", data: "Second section of the article" },
						title: "Part 2",
						citations: { enabled: true },
					},
				],
			}],
		});

		expect(createChatCompletion).toHaveBeenCalledWith(
			expect.objectContaining({
				messages: [
					{ role: "system", content: "You are a summarizer." },
					{ role: "user", content: "First section of the article\nSecond section of the article" },
				],
			}),
		);
	});

	it("should cap max_tokens to 8192", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"summary":"s","excerpt":"e"}' } }],
			usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		await createMessage({
			max_tokens: 10240,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(createChatCompletion).toHaveBeenCalledWith(
			expect.objectContaining({ max_tokens: 8192 }),
		);
	});

	it("should throw when response has no usage data", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"summary":"s","excerpt":"e"}' } }],
			usage: null,
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });

		await expect(createMessage({
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		})).rejects.toThrow("DeepSeek response missing usage data");
	});

	it("should answer without a cache split when usage omits one, rather than failing the call", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"summary":"s","excerpt":"e"}' } }],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		const result = await createMessage({
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(result.usage.input_tokens).toBe(10);
		expect(result.usage.cache_hit_input_tokens).toBeUndefined();
		expect(result.usage.cache_miss_input_tokens).toBeUndefined();
	});
});

describe("initCreateDeepseekThinkingMessage", () => {
	it("should call deepseek-v4-pro with thinking enabled, json mode and no temperature", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"links":[]}' } }],
			usage: { prompt_tokens: 50, completion_tokens: 20 },
		});

		const createMessage = initCreateDeepseekThinkingMessage({ createChatCompletion });
		await createMessage({
			max_tokens: 32768,
			system: "You are a filter.",
			messages: [{ role: "user", content: "Filter these links" }],
		});

		expect(createChatCompletion.mock.calls[0][0]).toEqual({
			model: "deepseek-v4-pro",
			thinking: { type: "enabled" },
			max_tokens: 32768,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "You are a filter." },
				{ role: "user", content: "Filter these links" },
			],
		});
	});

	it("should cap max_tokens to 65536", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"links":[]}' } }],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});

		const createMessage = initCreateDeepseekThinkingMessage({ createChatCompletion });
		await createMessage({
			max_tokens: 100_000,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(createChatCompletion).toHaveBeenCalledWith(
			expect.objectContaining({ max_tokens: 65536 }),
		);
	});

	it("should keep a max_tokens at the 65536 cap unchanged", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"links":[]}' } }],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});

		const createMessage = initCreateDeepseekThinkingMessage({ createChatCompletion });
		await createMessage({
			max_tokens: 65536,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(createChatCompletion).toHaveBeenCalledWith(
			expect.objectContaining({ max_tokens: 65536 }),
		);
	});

	it("should pass the answer through and ignore the reasoning content", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: ' {"links":[]} ', reasoning_content: "Let me think about each link." } }],
			usage: {
				prompt_tokens: 40,
				completion_tokens: 900,
				prompt_cache_hit_tokens: 30,
				prompt_cache_miss_tokens: 10,
				completion_tokens_details: { reasoning_tokens: 850 },
			},
		});

		const createMessage = initCreateDeepseekThinkingMessage({ createChatCompletion });
		const result = await createMessage({
			max_tokens: 1024,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(result).toEqual({
			content: [{ type: "text", text: '{"links":[]}' }],
			usage: {
				input_tokens: 40,
				output_tokens: 900,
				cache_hit_input_tokens: 30,
				cache_miss_input_tokens: 10,
				reasoning_tokens: 850,
			},
		});
	});

	it("should leave reasoning_tokens undefined when usage has no completion details", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"links":[]}' } }],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});

		const createMessage = initCreateDeepseekThinkingMessage({ createChatCompletion });
		const result = await createMessage({
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(result.usage.reasoning_tokens).toBeUndefined();
	});

	it("should throw when the thinking response has no message content", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: "", reasoning_content: "Thinking ran out of budget." } }],
			usage: { prompt_tokens: 10, completion_tokens: 65536 },
		});

		const createMessage = initCreateDeepseekThinkingMessage({ createChatCompletion });

		await expect(createMessage({
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		})).rejects.toThrow("DeepSeek response missing message content");
	});

	it("should throw when the thinking response has no usage data", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"links":[]}' } }],
			usage: null,
		});

		const createMessage = initCreateDeepseekThinkingMessage({ createChatCompletion });

		await expect(createMessage({
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		})).rejects.toThrow("DeepSeek response missing usage data");
	});
});
