import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import { initPdfPageLlmCleanupHandler } from "./pdf-page-llm-cleanup-handler";
import type { CleanupPageWithLlm } from "./pdf-page-llm-cleanup-handler.types";

function stubLlm(text: string, tokens = { input: 100, output: 50 }): CleanupPageWithLlm {
	return async () => ({ text, tokens });
}

function capturingLogger(): { logger: HutchLogger; messages: string[] } {
	const messages: string[] = [];
	const record = (msg: unknown) => { messages.push(String(msg)); };
	return {
		logger: { info: record, warn: record, error: record, debug: record },
		messages,
	};
}

describe("initPdfPageLlmCleanupHandler", () => {
	it("returns the cleaned text with applied=true when guardrails pass", async () => {
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm("Repository of the Reading Room."),
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 3, ocrText: "Vepository of the Reading Room." });

		expect(result).toEqual({
			pageIndex: 3,
			cleanedText: "Repository of the Reading Room.",
			applied: true,
			tokens: { input: 100, output: 50 },
		});
	});

	it("returns the original text with applied=false when the model rewrites too much (length-delta)", async () => {
		const original = "x".repeat(200);
		const tooShort = "x".repeat(50);
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm(tooShort),
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 1, ocrText: original });

		expect(result.applied).toBe(false);
		expect(result.cleanedText).toBe(original);
		// Token usage is still surfaced when guardrails reject (the call did happen).
		expect(result.tokens).toEqual({ input: 100, output: 50 });
	});

	it("returns the original text with applied=false when the model mutated a digit", async () => {
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm("year 1986 was important"),
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 0, ocrText: "year 1968 was important" });

		expect(result.applied).toBe(false);
		expect(result.cleanedText).toBe("year 1968 was important");
	});

	it("returns the original text with applied=false when the model collapsed a paragraph break", async () => {
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm("alpha beta"),
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 0, ocrText: "alpha\n\nbeta" });

		expect(result.applied).toBe(false);
		expect(result.cleanedText).toBe("alpha\n\nbeta");
	});

	it("logs the rejection reason when guardrails reject", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm("year 1986"),
			logger,
		});

		await handler({ pageIndex: 7, ocrText: "year 1968" });

		const rejection = messages.find((m) => m.includes("guardrail rejected"));
		expect(rejection).toBeDefined();
		expect(rejection).toContain("reason=digits-mutated");
		expect(rejection).toContain("page=7");
	});

	it("returns the original text with applied=false when the LLM call throws (no rethrow)", async () => {
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: async () => { throw new Error("DeepSeek 5xx"); },
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 4, ocrText: "the original page text" });

		expect(result).toEqual({ pageIndex: 4, cleanedText: "the original page text", applied: false });
	});

	it("stringifies a non-Error throw from the LLM call", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: async () => { throw "raw string"; },
			logger,
		});

		const result = await handler({ pageIndex: 2, ocrText: "hi" });

		expect(result.applied).toBe(false);
		expect(messages.some((m) => m.includes("LLM call failed") && m.includes("raw string"))).toBe(true);
	});

	it("short-circuits empty input without calling the LLM", async () => {
		let calls = 0;
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: async () => { calls += 1; return { text: "anything", tokens: { input: 1, output: 1 } }; },
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 0, ocrText: "" });

		expect(result).toEqual({ pageIndex: 0, cleanedText: "", applied: false });
		expect(calls).toBe(0);
	});

	it("short-circuits whitespace-only input without calling the LLM", async () => {
		let calls = 0;
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: async () => { calls += 1; return { text: "anything", tokens: { input: 1, output: 1 } }; },
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 0, ocrText: "   \n  \n  " });

		expect(result.applied).toBe(false);
		expect(calls).toBe(0);
	});

	it("rejects malformed payloads (missing pageIndex) via Zod", async () => {
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm("ok"),
			logger: noopLogger,
		});

		await expect(handler({ ocrText: "x" })).rejects.toThrow();
	});

	it("rejects malformed payloads (negative pageIndex) via Zod", async () => {
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm("ok"),
			logger: noopLogger,
		});

		await expect(handler({ pageIndex: -1, ocrText: "x" })).rejects.toThrow();
	});

	it("rejects malformed payloads (missing ocrText) via Zod", async () => {
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: stubLlm("ok"),
			logger: noopLogger,
		});

		await expect(handler({ pageIndex: 0 })).rejects.toThrow();
	});

	it("computes maxTokens proportional to input length, with a 256-token floor", async () => {
		const captured: number[] = [];
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: async ({ userText, maxTokens }) => {
				captured.push(maxTokens);
				return { text: userText, tokens: { input: 1, output: 1 } };
			},
			logger: noopLogger,
		});

		// 40 chars → 2*40/4 = 20 → bumped to the 256 floor.
		await handler({ pageIndex: 0, ocrText: "x".repeat(40) });
		// 1200 chars → 2*1200/4 = 600 → above the floor, used directly.
		await handler({ pageIndex: 0, ocrText: "x".repeat(1200) });
		// 6000 chars → 2*6000/4 = 3000 → above the floor, scales linearly.
		await handler({ pageIndex: 0, ocrText: "x".repeat(6000) });

		expect(captured).toEqual([256, 600, 3000]);
	});

	it("passes the loaded prompt to the LLM call as the system prompt", async () => {
		let captured: string | undefined;
		const handler = initPdfPageLlmCleanupHandler({
			cleanupPageWithLlm: async ({ systemPrompt, userText }) => {
				captured = systemPrompt;
				return { text: userText, tokens: { input: 1, output: 1 } };
			},
			logger: noopLogger,
		});

		await handler({ pageIndex: 0, ocrText: "x" });

		expect(captured).toBeDefined();
		expect(captured).toContain("OCR errors");
		expect(captured).toContain("RULES");
	});
});
