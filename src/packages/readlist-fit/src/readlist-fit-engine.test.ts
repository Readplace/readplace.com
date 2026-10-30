import { createAiMessageForEngine, ReadlistFitEngineSchema } from "./readlist-fit-engine";

function capturingCompletion() {
	const calls: { model: string; thinking: { type: string } }[] = [];
	const createChatCompletion = async (params: { model: string; thinking: { type: "enabled" } | { type: "disabled" } }) => {
		calls.push({ model: params.model, thinking: params.thinking });
		return {
			choices: [{ message: { content: '{"links": []}' } }],
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		};
	};
	return { calls, createChatCompletion };
}

describe("createAiMessageForEngine", () => {
	it("calls deepseek-flash with thinking disabled", async () => {
		const { calls, createChatCompletion } = capturingCompletion();

		await createAiMessageForEngine({ engine: "deepseek-flash", createChatCompletion })({
			max_tokens: 10,
			system: "s",
			messages: [{ role: "user", content: "u" }],
		});

		expect(calls).toEqual([{ model: "deepseek-flash", thinking: { type: "disabled" } }]);
	});

	it("calls deepseek-v4-pro with thinking enabled on the rollback engine", async () => {
		const { calls, createChatCompletion } = capturingCompletion();

		await createAiMessageForEngine({ engine: "deepseek-v4-pro-thinking", createChatCompletion })({
			max_tokens: 10,
			system: "s",
			messages: [{ role: "user", content: "u" }],
		});

		expect(calls).toEqual([{ model: "deepseek-v4-pro", thinking: { type: "enabled" } }]);
	});
});

describe("ReadlistFitEngineSchema", () => {
	it("rejects an engine outside the switch", () => {
		expect(ReadlistFitEngineSchema.safeParse("deepseek-chat").success).toBe(false);
	});
});
