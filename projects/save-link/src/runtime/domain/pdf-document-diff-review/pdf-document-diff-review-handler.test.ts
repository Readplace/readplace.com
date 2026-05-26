import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import { initPdfDocumentDiffReviewHandler } from "./pdf-document-diff-review-handler";
import type { ReviewDocumentWithLlm } from "./pdf-document-diff-review-handler.types";

function llmReturning(text: string, tokens = { input: 200, output: 100 }): ReviewDocumentWithLlm {
	return async () => ({ text, tokens });
}

function decisionsJson(decisions: Array<Record<string, unknown>>): string {
	return JSON.stringify({ decisions });
}

function capturingLogger(): { logger: HutchLogger; messages: string[] } {
	const messages: string[] = [];
	const record = (msg: unknown) => { messages.push(String(msg)); };
	return { logger: { info: record, warn: record, error: record, debug: record }, messages };
}

describe("initPdfDocumentDiffReviewHandler", () => {
	it("returns cleanedText untouched when there are no diffs to review", async () => {
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(decisionsJson([])),
			logger: noopLogger,
		});

		const result = await handler({
			pages: [{ pageIndex: 0, originalText: "same", cleanedText: "same" }],
		});

		expect(result).toEqual({
			pages: [{ pageIndex: 0, finalText: "same" }],
			applied: false,
		});
	});

	it("applies APPROVE decisions to the original text", async () => {
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(decisionsJson([
				{ diff_id: 1, decision: "APPROVE" },
			])),
			logger: noopLogger,
		});

		const result = await handler({
			pages: [{ pageIndex: 0, originalText: "the Vepository here", cleanedText: "the Repository here" }],
		});

		expect(result.applied).toBe(true);
		expect(result.pages[0].finalText).toBe("the Repository here");
	});

	it("reverts REJECT decisions back to the original text", async () => {
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(decisionsJson([
				{ diff_id: 1, decision: "REJECT" },
			])),
			logger: noopLogger,
		});

		const result = await handler({
			pages: [{ pageIndex: 0, originalText: "see Hargis", cleanedText: "see Harris" }],
		});

		// Hargis vs Harris — stage 1 "corrected" Hargis to Harris, stage 2 rejects.
		expect(result.pages[0].finalText).toBe("see Hargis");
	});

	it("falls back to cleanedText when the model response is malformed JSON", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning("not json at all"),
			logger,
		});

		const result = await handler({
			pages: [{ pageIndex: 0, originalText: "orig", cleanedText: "cleaned" }],
		});

		expect(result.applied).toBe(false);
		expect(result.pages[0].finalText).toBe("cleaned");
		expect(messages.some((m) => m.includes("malformed model response"))).toBe(true);
	});

	it("falls back to cleanedText when the model response is JSON but the schema fails", async () => {
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(JSON.stringify({ decisions: [{ wrong: "shape" }] })),
			logger: noopLogger,
		});

		const result = await handler({
			pages: [{ pageIndex: 0, originalText: "alpha Bravo", cleanedText: "alpha Charlie" }],
		});

		expect(result.applied).toBe(false);
		expect(result.pages[0].finalText).toBe("alpha Charlie");
	});

	it("falls back to cleanedText when the LLM call throws (no rethrow)", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: async () => { throw new Error("DeepSeek 5xx"); },
			logger,
		});

		const result = await handler({
			pages: [{ pageIndex: 0, originalText: "alpha", cleanedText: "beta" }],
		});

		expect(result.applied).toBe(false);
		expect(result.pages[0].finalText).toBe("beta");
		expect(messages.some((m) => m.includes("LLM call failed") && m.includes("DeepSeek 5xx"))).toBe(true);
	});

	it("stringifies non-Error throws from the LLM call", async () => {
		const { logger, messages } = capturingLogger();
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: async () => { throw "raw string thrown"; },
			logger,
		});

		await handler({
			pages: [{ pageIndex: 0, originalText: "alpha", cleanedText: "beta" }],
		});

		expect(messages.some((m) => m.includes("LLM call failed") && m.includes("raw string thrown"))).toBe(true);
	});

	it("blocks digit-mutating decisions at the per-span guardrail (before they reach the document-level check)", async () => {
		// Per-span guardrail short-circuits inside applyDecisions, so an
		// APPROVE that would swap 1968→1986 is silently dropped and the page
		// keeps the original Tesseract digit. The handler still reports
		// applied=true because the decision was processed — it just landed in
		// the `skippedReasons` log rather than mutating the page.
		const { logger, messages } = capturingLogger();
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(decisionsJson([
				{ diff_id: 1, decision: "APPROVE" },
			])),
			logger,
		});

		const result = await handler({
			pages: [{
				pageIndex: 0,
				originalText: "year 1968 was busy",
				cleanedText: "year 1986 was busy",
			}],
		});

		expect(result.pages[0].finalText).toBe("year 1968 was busy");
		expect(result.applied).toBe(true);
		expect(messages.some((m) => m.includes("skipped="))).toBe(true);
	});

	it("falls back to cleanedText when the document-level length-delta guardrail rejects the applied output", async () => {
		// Stage 1 ate the entire page (cleanedText=""), so the diff entry is
		// a full-text removal. The per-span guardrail allows it (empty
		// replacement bypasses the 50% delta), but at the document level the
		// 100% length drop blows the 30% cap — handler bails to cleanedText.
		const { logger, messages } = capturingLogger();
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(decisionsJson([
				{ diff_id: 1, decision: "APPROVE" },
			])),
			logger,
		});

		const result = await handler({
			pages: [{
				pageIndex: 0,
				originalText: "the quick brown fox jumps over the lazy dog",
				cleanedText: "",
			}],
		});

		expect(result.applied).toBe(false);
		expect(result.pages[0].finalText).toBe("");
		expect(messages.some((m) => m.includes("document-level guardrail rejected"))).toBe(true);
	});

	it("rejects malformed payloads via Zod", async () => {
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(decisionsJson([])),
			logger: noopLogger,
		});

		await expect(handler({ pages: "not an array" })).rejects.toThrow();
	});

	it("rejects malformed payloads via Zod (page entry missing fields)", async () => {
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: llmReturning(decisionsJson([])),
			logger: noopLogger,
		});

		await expect(
			handler({ pages: [{ pageIndex: 0, originalText: "x" }] }),
		).rejects.toThrow();
	});

	it("includes precedingTail and followingHead for middle pages but not for edges", async () => {
		let capturedMessage = "";
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: async ({ userMessage }) => {
				capturedMessage = userMessage;
				return { text: decisionsJson([]), tokens: { input: 1, output: 1 } };
			},
			logger: noopLogger,
		});

		await handler({
			pages: [
				{ pageIndex: 0, originalText: "p0", cleanedText: "p0 mod" },
				{ pageIndex: 1, originalText: "p1", cleanedText: "p1 mod" },
				{ pageIndex: 2, originalText: "p2", cleanedText: "p2 mod" },
			],
		});

		const payload = JSON.parse(capturedMessage);
		expect(payload.pages[0].precedingTail).toBeUndefined();
		expect(payload.pages[0].followingHead).toBe("p1 mod");
		expect(payload.pages[1].precedingTail).toBe("p0 mod");
		expect(payload.pages[1].followingHead).toBe("p2 mod");
		expect(payload.pages[2].followingHead).toBeUndefined();
	});

	it("accumulates token counts across multiple LLM calls when the total payload triggers chunking", async () => {
		// Each page's cleanedText is ~150k chars of words separated by spaces
		// so the context windows stay bounded. Three such pages give
		// pageChars=~150k each → first page fits, second page's accumulator
		// trips the budget and pushes a chunk, third page goes into its own
		// chunk. Exercises the accumulator-overflow branch in
		// chunkPagesByPayloadSize.
		const calls: number[] = [];
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: async () => {
				calls.push(1);
				return { text: decisionsJson([]), tokens: { input: 1000, output: 200 } };
			},
			logger: noopLogger,
		});

		// 30_000 words × 5 chars each ≈ 150k chars per page; well-formed token
		// boundaries keep contextBefore/After to ~30 words apiece (≤300 chars).
		const wordsPerPage = 30_000;
		const originalText = Array.from({ length: wordsPerPage }, (_, i) => `word${i}`).join(" ");
		const cleanedText = originalText.replace("word0 ", "WORD0 ");
		const result = await handler({
			pages: [
				{ pageIndex: 0, originalText, cleanedText },
				{ pageIndex: 1, originalText, cleanedText },
				{ pageIndex: 2, originalText, cleanedText },
			],
		});

		expect(calls.length).toBeGreaterThan(1);
		expect(result.tokens?.input).toBe(1000 * calls.length);
		expect(result.tokens?.output).toBe(200 * calls.length);
	});

	it("emits a single chunk containing an oversize page rather than dropping it", async () => {
		let chunkCount = 0;
		const handler = initPdfDocumentDiffReviewHandler({
			reviewDocumentWithLlm: async () => {
				chunkCount += 1;
				return { text: decisionsJson([]), tokens: { input: 1, output: 1 } };
			},
			logger: noopLogger,
		});

		// A single 2 MB-of-x page blows past the 400k-char budget on its own.
		// Hits the "oversize single page" branch — the page is emitted alone
		// so DeepSeek (or its failure fallback) sees it rather than being
		// silently dropped.
		const oversize = "x".repeat(2_000_000);
		await handler({
			pages: [{ pageIndex: 0, originalText: oversize, cleanedText: `${oversize}!` }],
		});

		expect(chunkCount).toBe(1);
	});
});
