import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import { initPdfPageHtmlConvertHandler } from "./pdf-page-html-convert-handler";
import type { ConvertPageToHtmlWithLlm } from "./pdf-page-html-convert-handler.types";

function stubLlm(text: string, tokens = { input: 100, output: 50 }): ConvertPageToHtmlWithLlm {
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

describe("initPdfPageHtmlConvertHandler", () => {
	it("returns the sanitised semantic HTML with applied=true when guardrails pass", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("<h2>Section</h2><p>Body prose here that is long enough to retain content.</p>"),
			logger: noopLogger,
		});

		const result = await handler({
			pageIndex: 3,
			pageText: "Section\n\nBody prose here that is long enough to retain content.",
		});

		expect(result.applied).toBe(true);
		expect(result.semanticHtml).toBe("<h2>Section</h2><p>Body prose here that is long enough to retain content.</p>");
		expect(result.tokens).toEqual({ input: 100, output: 50 });
	});

	it("strips ```html fences the model occasionally emits despite the prompt rule", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("```html\n<h2>Section</h2><p>Body prose here that is long enough to retain content.</p>\n```"),
			logger: noopLogger,
		});

		const result = await handler({
			pageIndex: 0,
			pageText: "Section\n\nBody prose here that is long enough to retain content.",
		});

		expect(result.applied).toBe(true);
		expect(result.semanticHtml).not.toContain("```");
		expect(result.semanticHtml).toContain("<h2>Section</h2>");
	});

	it("strips bare ``` fences (no language tag)", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("```\n<p>Body prose here that is long enough to retain content.</p>\n```"),
			logger: noopLogger,
		});

		const result = await handler({
			pageIndex: 0,
			pageText: "Body prose here that is long enough to retain content.",
		});

		expect(result.applied).toBe(true);
		expect(result.semanticHtml).toBe("<p>Body prose here that is long enough to retain content.</p>");
	});

	it("falls back to <p class=\"ocr-tesseract\"> wrap when the LLM call throws", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: async () => { throw new Error("DeepSeek 5xx"); },
			logger,
		});

		const result = await handler({
			pageIndex: 7,
			pageText: "first paragraph here\n\nsecond paragraph here",
		});

		expect(result.applied).toBe(false);
		expect(result.semanticHtml).toBe(
			'<p class="ocr-tesseract">first paragraph here</p>'
			+ '<p class="ocr-tesseract">second paragraph here</p>',
		);
		expect(messages.some((m) => m.includes("LLM call failed") && m.includes("DeepSeek 5xx"))).toBe(true);
	});

	it("falls back when the LLM throws an OpenAI-shape 429 (status surfaced in the log)", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: async () => {
				throw Object.assign(new Error("Too Many Requests"), { status: 429 });
			},
			logger,
		});

		const result = await handler({ pageIndex: 2, pageText: "some text" });

		expect(result.applied).toBe(false);
		expect(messages.some((m) => m.includes("status=429"))).toBe(true);
	});

	it("stringifies non-Error throws in the log fallback", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: async () => { throw "raw string"; },
			logger,
		});

		await handler({ pageIndex: 0, pageText: "x" });

		expect(messages.some((m) => m.includes("LLM call failed") && m.includes("raw string"))).toBe(true);
	});

	it("rejects when the model output is empty and falls back to paragraph wrap", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm(""),
			logger,
		});

		const result = await handler({ pageIndex: 1, pageText: "the original prose for the page" });

		expect(result.applied).toBe(false);
		expect(result.semanticHtml).toContain("the original prose for the page");
		expect(messages.some((m) => m.includes("reason=empty-output"))).toBe(true);
	});

	it("rejects when the model dropped more than 30% of the page's visible text", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("<h2>tl;dr</h2>"),
			logger,
		});

		const longInput = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
		const result = await handler({ pageIndex: 1, pageText: longInput });

		expect(result.applied).toBe(false);
		expect(messages.some((m) => m.includes("reason=text-loss-exceeded"))).toBe(true);
	});

	it("surfaces tokens even when guardrails reject the model output", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("<h2>tl;dr</h2>", { input: 80, output: 5 }),
			logger: noopLogger,
		});

		const longInput = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
		const result = await handler({ pageIndex: 1, pageText: longInput });

		expect(result.applied).toBe(false);
		expect(result.tokens).toEqual({ input: 80, output: 5 });
	});

	it("short-circuits empty input without invoking the LLM", async () => {
		let calls = 0;
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: async () => { calls += 1; return { text: "x", tokens: { input: 1, output: 1 } }; },
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 0, pageText: "" });

		expect(result).toEqual({ pageIndex: 0, semanticHtml: "", applied: false });
		expect(calls).toBe(0);
	});

	it("short-circuits whitespace-only input", async () => {
		let calls = 0;
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: async () => { calls += 1; return { text: "x", tokens: { input: 1, output: 1 } }; },
			logger: noopLogger,
		});

		const result = await handler({ pageIndex: 0, pageText: "  \n  \n  " });

		expect(result.applied).toBe(false);
		expect(calls).toBe(0);
	});

	it("rejects malformed payloads (missing pageIndex) via Zod", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("<p>x</p>"),
			logger: noopLogger,
		});
		await expect(handler({ pageText: "x" })).rejects.toThrow();
	});

	it("rejects malformed payloads (negative pageIndex) via Zod", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("<p>x</p>"),
			logger: noopLogger,
		});
		await expect(handler({ pageIndex: -1, pageText: "x" })).rejects.toThrow();
	});

	it("rejects malformed payloads (missing pageText) via Zod", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm("<p>x</p>"),
			logger: noopLogger,
		});
		await expect(handler({ pageIndex: 0 })).rejects.toThrow();
	});

	it("passes the loaded prompt to the LLM call as the system prompt", async () => {
		let captured: string | undefined;
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: async ({ systemPrompt, userText }) => {
				captured = systemPrompt;
				return { text: `<p>${userText}</p>`, tokens: { input: 1, output: 1 } };
			},
			logger: noopLogger,
		});

		await handler({ pageIndex: 0, pageText: "hello world" });

		expect(captured).toBeDefined();
		expect(captured).toContain("semantically valid HTML5");
		expect(captured).toContain("Output ONLY the HTML5 fragment");
	});

	it("computes maxTokens proportional to input length with a 256-token floor", async () => {
		const captured: number[] = [];
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: async ({ userText, maxTokens }) => {
				captured.push(maxTokens);
				return { text: `<p>${userText}</p>`, tokens: { input: 1, output: 1 } };
			},
			logger: noopLogger,
		});

		await handler({ pageIndex: 0, pageText: "x".repeat(40) });
		await handler({ pageIndex: 0, pageText: "x".repeat(1200) });
		await handler({ pageIndex: 0, pageText: "x".repeat(6000) });

		expect(captured).toEqual([256, 600, 3000]);
	});

	it("strips dangerous tags via the shared sanitiser before the guardrail runs", async () => {
		const handler = initPdfPageHtmlConvertHandler({
			convertPageToHtmlWithLlm: stubLlm('<h2>Title</h2><script>alert(1)</script><p>Body prose that is long enough to retain content.</p>'),
			logger: noopLogger,
		});

		const result = await handler({
			pageIndex: 0,
			pageText: "Title\n\nBody prose that is long enough to retain content.",
		});

		expect(result.applied).toBe(true);
		expect(result.semanticHtml).not.toContain("<script");
		expect(result.semanticHtml).toContain("<h2>Title</h2>");
	});
});
