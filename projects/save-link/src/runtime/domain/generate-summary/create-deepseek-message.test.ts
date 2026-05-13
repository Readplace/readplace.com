import { initCreateDeepseekMessage } from "./create-deepseek-message";

describe("initCreateDeepseekMessage", () => {
	it("should prepend system message and pass JSON content through unchanged", async () => {
		const jsonPayload = JSON.stringify({
			summary: "Article explains quantum computing basics",
			excerpt: "Quick primer on qubits.",
		});
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: jsonPayload } }],
			usage: { prompt_tokens: 50, completion_tokens: 20 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		const result = await createMessage({
			model: "ignored-model",
			max_tokens: 1024,
			system: "You are a summarizer.",
			messages: [{ role: "user", content: "Summarize this article" }],
		});

		expect(createChatCompletion).toHaveBeenCalledWith({
			model: "deepseek-chat",
			max_tokens: 1024,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: "You are a summarizer." },
				{ role: "user", content: "Summarize this article" },
			],
		});
		expect(result).toEqual({
			content: [{ type: "text", text: jsonPayload }],
			usage: { input_tokens: 50, output_tokens: 20 },
		});
	});

	it("should trim whitespace from response content", async () => {
		const jsonPayload = JSON.stringify({ summary: "trimmed", excerpt: "blurb" });
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: `  ${jsonPayload}  \n` } }],
			usage: { prompt_tokens: 5, completion_tokens: 3 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		const result = await createMessage({
			model: "any",
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		});

		expect(result.content[0].text).toBe(jsonPayload);
	});

	it("should throw when response has no message content", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: null } }],
			usage: { prompt_tokens: 10, completion_tokens: 0 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });

		await expect(createMessage({
			model: "any",
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		})).rejects.toThrow("DeepSeek response missing message content");
	});

	it("should extract text from document content blocks", async () => {
		const createChatCompletion = jest.fn().mockResolvedValue({
			choices: [{ message: { content: '{"summary":"s","excerpt":"e"}' } }],
			usage: { prompt_tokens: 60, completion_tokens: 15 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		await createMessage({
			model: "ignored-model",
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
			usage: { prompt_tokens: 80, completion_tokens: 10 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		await createMessage({
			model: "ignored-model",
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
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});

		const createMessage = initCreateDeepseekMessage({ createChatCompletion });
		await createMessage({
			model: "any",
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
			model: "any",
			max_tokens: 100,
			system: "system",
			messages: [{ role: "user", content: "hello" }],
		})).rejects.toThrow("DeepSeek response missing usage data");
	});
});
