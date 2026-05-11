import {
	initCreateDeepInfraVisionMessage,
	DEEPINFRA_VISION_MODEL_ID,
	DEEPINFRA_VISION_MAX_BATCH_OUTPUT_TOKENS,
} from "./create-deepinfra-vision-message";

describe("initCreateDeepInfraVisionMessage", () => {
	it("sends a single user message with each image rendered as a base64 image_url block plus the OCR instruction", async () => {
		let captured: { model: string; max_tokens: number; messages: ReadonlyArray<unknown> } | undefined;
		const createChatCompletion = async (params: { model: string; max_tokens: number; messages: ReadonlyArray<unknown> }) => {
			captured = params;
			return { choices: [{ message: { content: "extracted text" } }] };
		};
		const createVisionMessage = initCreateDeepInfraVisionMessage({ createChatCompletion });

		const result = await createVisionMessage({
			images: [
				{ pngBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
				{ pngBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xaa]) },
			],
		});

		expect(result).toBe("extracted text");
		expect(captured?.model).toBe(DEEPINFRA_VISION_MODEL_ID);
		expect(captured?.max_tokens).toBe(DEEPINFRA_VISION_MAX_BATCH_OUTPUT_TOKENS);
		expect(captured?.messages).toHaveLength(1);
		const message = captured?.messages[0] as { role: string; content: Array<{ type: string; text?: string; image_url?: { url: string } }> };
		expect(message.role).toBe("user");
		expect(message.content).toHaveLength(3);
		expect(message.content[0]?.type).toBe("text");
		expect(message.content[0]?.text).toContain("Extract all text");
		expect(message.content[1]?.type).toBe("image_url");
		expect(message.content[1]?.image_url?.url).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`);
		expect(message.content[2]?.type).toBe("image_url");
		expect(message.content[2]?.image_url?.url).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xaa]).toString("base64")}`);
	});

	it("returns the trimmed text content from the first choice", async () => {
		const createChatCompletion = async () => ({
			choices: [{ message: { content: "  trimmed content\n\n" } }],
		});
		const createVisionMessage = initCreateDeepInfraVisionMessage({ createChatCompletion });

		const result = await createVisionMessage({ images: [{ pngBuffer: Buffer.from([0]) }] });

		expect(result).toBe("trimmed content");
	});

	it("asserts when called with no images", async () => {
		const createChatCompletion = async () => ({ choices: [{ message: { content: "ok" } }] });
		const createVisionMessage = initCreateDeepInfraVisionMessage({ createChatCompletion });

		await expect(createVisionMessage({ images: [] })).rejects.toThrow(
			"createVisionMessage requires at least one image",
		);
	});

	it("asserts when the response message has no content", async () => {
		const createChatCompletion = async () => ({ choices: [{ message: { content: null } }] });
		const createVisionMessage = initCreateDeepInfraVisionMessage({ createChatCompletion });

		await expect(createVisionMessage({ images: [{ pngBuffer: Buffer.from([0]) }] })).rejects.toThrow(
			"DeepInfra vision response missing message content",
		);
	});

	it("asserts when the response has no choices", async () => {
		const createChatCompletion = async () => ({ choices: [] });
		const createVisionMessage = initCreateDeepInfraVisionMessage({ createChatCompletion });

		await expect(createVisionMessage({ images: [{ pngBuffer: Buffer.from([0]) }] })).rejects.toThrow(
			"DeepInfra vision response missing message content",
		);
	});
});

