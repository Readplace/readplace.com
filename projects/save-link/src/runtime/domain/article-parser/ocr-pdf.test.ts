import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import { escapeHtmlText, type ExtractPdfMetadata } from "@packages/crawl-article";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";
import type { InvokePdfPageLlmCleanup } from "./pdf-page-llm-cleanup-invoker.types";
import type { InvokePdfDocumentDiffReview } from "./pdf-document-diff-review-invoker.types";
import type { InvokePdfPageHtmlConvert } from "./pdf-page-html-convert-invoker.types";
import { initOcrPdf } from "./ocr-pdf";

function stubMetadata(meta: { numPages: number; title?: string }): ExtractPdfMetadata {
	return async () => ({ numPages: meta.numPages, title: meta.title });
}

function stubStagePdf(opts: { key?: string; onCleanup?: () => void } = {}): StagePdfToS3 {
	return async () => ({
		key: opts.key ?? "pdf-rasterise-staging/test-uuid/source.pdf",
		cleanup: async () => { opts.onCleanup?.(); },
	});
}

/** Wraps each page's text in the Tesseract-shape HTML the real provider emits. */
function tesseractParagraph(text: string): string {
	return `<p class="ocr-tesseract">${text}</p>`;
}

function stubInvokePageOcr(text: (pageIndex: number) => string): InvokePdfPageOcr {
	return async ({ pageIndices }) => ({
		ok: true,
		html: pageIndices.map((idx) => tesseractParagraph(text(idx))).join(""),
	});
}

/** Cleanup pass-through: returns the original Tesseract text unchanged so
 * tests that don't care about cleanup behaviour observe just the Tesseract
 * fan-out + diff-review pipeline. `applied: false` keeps the input/output
 * symmetric (the handler reports this when guardrails reject; here it just
 * means the model produced no corrections). */
const stubCleanupPassthrough: InvokePdfPageLlmCleanup = async ({ ocrText }) => ({
	ok: true,
	cleanedText: ocrText,
	applied: false,
	tokens: { input: 0, output: 0 },
});

/** Diff-review pass-through: returns each page's cleanedText as the final
 * text. Used by tests that exercise the orchestration but not the diff-
 * review logic. */
const stubDiffReviewPassthrough: InvokePdfDocumentDiffReview = async ({ pages }) => ({
	ok: true,
	pages: pages.map((p) => ({ pageIndex: p.pageIndex, finalText: p.cleanedText })),
	applied: false,
});

/** HTML-convert pass-through: wraps each paragraph of the page text in a
 * `<p class="ocr-tesseract">` element the same way Stage 3's own fallback
 * would. This is the "no semantic structure" baseline, matching the legacy
 * pre-Stage-3 output so existing assertions about paragraph text continue
 * to hold. */
const stubHtmlConvertPassthrough: InvokePdfPageHtmlConvert = async ({ pageIndex, pageText }) => {
	const semanticHtml = pageText
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.trim())
		.filter((paragraph) => paragraph.length > 0)
		.map((paragraph) => `<p class="ocr-tesseract">${escapeHtmlText(paragraph)}</p>`)
		.join("");
	return { ok: true, semanticHtml, applied: false, pageIndex };
};

function makeOcr(overrides: Partial<Parameters<typeof initOcrPdf>[0]> = {}) {
	return initOcrPdf({
		logger: noopLogger,
		extractPdfMetadata: stubMetadata({ numPages: 1 }),
		stagePdf: stubStagePdf(),
		invokePageOcr: stubInvokePageOcr(() => "default page text"),
		invokePageLlmCleanup: stubCleanupPassthrough,
		invokeDocumentDiffReview: stubDiffReviewPassthrough,
		invokePageHtmlConvert: stubHtmlConvertPassthrough,
		...overrides,
	});
}

describe("initOcrPdf — fan-out per page Lambda", () => {
	it("returns synthetic HTML stitched from per-page invocation fragments", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3, title: "Scanned Document" }),
			invokePageOcr: stubInvokePageOcr((i) => `page-${i + 1}`),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/scan.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Scanned Document");
		expect(result.html).toContain("<title>Scanned Document</title>");
		expect(result.html).toContain("<h1>Scanned Document</h1>");
		expect(result.html).toContain('<p class="ocr-tesseract">page-1</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">page-2</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">page-3</p>');
	});

	it("dispatches one invocation per chunk carrying the staged key, page indices, and DPI", async () => {
		const captured: Array<{ pdfS3Key: string; pageIndices: readonly number[]; dpi: number }> = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 7 }),
			stagePdf: stubStagePdf({ key: "pdf-rasterise-staging/abc/source.pdf" }),
			invokePageOcr: async (input) => {
				captured.push({ pdfS3Key: input.pdfS3Key, pageIndices: input.pageIndices, dpi: input.dpi });
				return { ok: true, html: input.pageIndices.map((i) => tesseractParagraph(`p${i}`)).join("") };
			},
			batchSize: 3,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(captured).toEqual([
			{ pdfS3Key: "pdf-rasterise-staging/abc/source.pdf", pageIndices: [0, 1, 2], dpi: 300 },
			{ pdfS3Key: "pdf-rasterise-staging/abc/source.pdf", pageIndices: [3, 4, 5], dpi: 300 },
			{ pdfS3Key: "pdf-rasterise-staging/abc/source.pdf", pageIndices: [6], dpi: 300 },
		]);
	});

	it("honours an overridden DPI in the invocation payload", async () => {
		const captured: number[] = [];
		const ocr = makeOcr({
			invokePageOcr: async ({ dpi, pageIndices }) => {
				captured.push(dpi);
				return { ok: true, html: pageIndices.map((i) => tesseractParagraph(`p${i}`)).join("") };
			},
			dpi: 200,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(captured).toEqual([200]);
	});

	it("concatenates chunk fragments in chunk-dispatch order even when invocations complete out of order", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			invokePageOcr: async ({ pageIndices }) => {
				const first = pageIndices[0];
				await new Promise((resolve) => setTimeout(resolve, (3 - first) * 5));
				return { ok: true, html: tesseractParagraph(`page-${first}`) };
			},
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		const p0 = result.html.indexOf("page-0");
		const p1 = result.html.indexOf("page-1");
		const p2 = result.html.indexOf("page-2");
		expect(p0).toBeGreaterThan(-1);
		expect(p1).toBeGreaterThan(p0);
		expect(p2).toBeGreaterThan(p1);
	});

	it("caps in-flight invocations to the configured concurrency", async () => {
		let inFlight = 0;
		let observedPeak = 0;
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			invokePageOcr: async ({ pageIndices }) => {
				inFlight += 1;
				observedPeak = Math.max(observedPeak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight -= 1;
				return { ok: true, html: tesseractParagraph(`${pageIndices[0]}`) };
			},
			concurrency: 3,
			batchSize: 1,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(observedPeak).toBeLessThanOrEqual(3);
		expect(observedPeak).toBeGreaterThan(0);
	});

	it("derives a title from the URL filename when the PDF has no Title metadata", async () => {
		const ocr = makeOcr({
			invokePageOcr: stubInvokePageOcr(() => "body text"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/files/sample_doc.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("sample doc");
	});

	it("escapes HTML-significant characters in the title", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 1, title: '"Risky" & <Funky>' }),
			invokePageOcr: stubInvokePageOcr(() => "safe body"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("&quot;Risky&quot; &amp; &lt;Funky&gt;");
	});

	it("returns 'unsupported-large-file' when the PDF exceeds maxPages", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 11 }),
			maxPages: 10,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/huge.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "unsupported-large-file" });
	});

	it("returns 'unsupported-large-file' when the PDF buffer exceeds maxPdfBytes", async () => {
		const ocr = makeOcr({ maxPdfBytes: 10 });

		const result = await ocr({ buffer: Buffer.alloc(11), url: "https://example.com/huge.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "unsupported-large-file" });
	});

	it("returns kind 'failed' when every page returns empty text", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			invokePageOcr: async () => ({ ok: true, html: "" }),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/blank.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR returned no text across all batches" });
	});

	it("returns kind 'failed' wrapping the underlying error when pdfinfo throws", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: async () => { throw new Error("invalid pdf"); },
		});

		const result = await ocr({ buffer: Buffer.from("not a pdf"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: invalid pdf" });
	});

	it("returns kind 'failed' stringifying a non-Error throw from pdfinfo", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: async () => { throw "opaque thrown"; },
		});

		const result = await ocr({ buffer: Buffer.from("nope"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: opaque thrown" });
	});

	it("returns kind 'failed' wrapping the underlying error when stagePdf throws", async () => {
		const ocr = makeOcr({
			stagePdf: async () => { throw new Error("S3 PutObject denied"); },
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: S3 PutObject denied" });
	});

	it("calls invokePageOcr exactly once per chunk before marking a failure (PAGE_OCR_MAX_ATTEMPTS=1)", async () => {
		const callsForFailingChunk: number[] = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 1) {
					callsForFailingChunk.push(pageIndices[0]);
					return { ok: false, error: new Error("Lambda timed out") };
				}
				return { ok: true, html: tesseractParagraph(`${pageIndices[0]}`) };
			},
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		// 2 successes out of 3 chunks = 67%, below the default 80% threshold.
		expect(result).toEqual({ kind: "failed", reason: "OCR succeeded for 2 of 3 chunks — below 80% threshold" });
		expect(callsForFailingChunk).toEqual([1]);
	});

	it("keeps dispatching sibling chunks after one chunk fails", async () => {
		const seen: number[] = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 5 }),
			invokePageOcr: async ({ pageIndices }) => {
				const pageIndex = pageIndices[0];
				seen.push(pageIndex);
				if (pageIndex === 1) return { ok: false, error: new Error("page 2 failed") };
				return { ok: true, html: tesseractParagraph(`${pageIndex}`) };
			},
			concurrency: 1,
			batchSize: 1,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(seen).toEqual([0, 1, 2, 3, 4]);
	});

	it("calls staged.cleanup() after a successful fan-out", async () => {
		let cleanupCalls = 0;
		const ocr = makeOcr({
			stagePdf: stubStagePdf({ onCleanup: () => { cleanupCalls += 1; } }),
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(cleanupCalls).toBe(1);
	});

	it("calls staged.cleanup() even when every page invocation fails", async () => {
		let cleanupCalls = 0;
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			stagePdf: stubStagePdf({ onCleanup: () => { cleanupCalls += 1; } }),
			invokePageOcr: async () => ({ ok: false, error: new Error("invoke failure") }),
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(cleanupCalls).toBe(1);
	});

	it("fires onProgress once per Tesseract chunk completion and once per cleanup chunk completion, plus the stage-change marker at zero", async () => {
		const progress: { partIndex: number; partCount: number; stage?: string }[] = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 6 }),
			invokePageOcr: async ({ pageIndices }) => ({
				ok: true,
				html: pageIndices.map((i) => tesseractParagraph(`p${i}`)).join(""),
			}),
			batchSize: 2,
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onProgress: (params) => { progress.push(params); },
		});

		// 6 pages / batchSize 2 = 3 chunks. Progress events emitted:
		//   - 3 Tesseract fires (one per chunk completion)
		//   - 1 cleanup stage-change marker (partIndex=0)
		//   - 3 cleanup fires (one per page completion)
		//   - 3 html-convert fires (one per page completion)
		// = 10 total. All three cleanup-side fires share the same
		// `comprehensive-cleaning` stage tag.
		expect(progress.length).toBe(10);
		expect(progress.filter((p) => p.stage === "comprehensive-extracting").length).toBe(3);
		expect(progress.filter((p) => p.stage === "comprehensive-cleaning").length).toBe(7);
		expect(progress.find((p) => p.stage === "comprehensive-cleaning" && p.partIndex === 0)).toBeDefined();
	});

	it("fires partIndex in chunk-completion order (out-of-order chunks still increment partIndex monotonically)", async () => {
		const progress: { partIndex: number; partCount: number; stage?: string }[] = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			invokePageOcr: async ({ pageIndices }) => {
				const first = pageIndices[0];
				await new Promise((resolve) => setTimeout(resolve, (3 - first) * 5));
				return { ok: true, html: tesseractParagraph(`${first}`) };
			},
			batchSize: 1,
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onProgress: (params) => { progress.push(params); },
		});

		const tesseractFires = progress.filter((p) => p.stage === "comprehensive-extracting");
		expect(tesseractFires.map((p) => p.partIndex)).toEqual([1, 2, 3]);
		expect(tesseractFires.every((p) => p.partCount === 3)).toBe(true);
	});

	it("treats a zero-page PDF as failed (no fragments to join)", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 0 }),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR returned no text across all batches" });
	});

	it("does not emit a retry warning under PAGE_OCR_MAX_ATTEMPTS=1 (no retries happen)", async () => {
		const warnings: string[] = [];
		const capturingLogger: HutchLogger = {
			info: () => {},
			error: () => {},
			warn: (msg) => { warnings.push(String(msg)); },
			debug: () => {},
		};
		const ocr = makeOcr({
			logger: capturingLogger,
			invokePageOcr: async () => ({ ok: false, error: new Error("nope") }),
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(warnings.filter((w) => w.includes("retrying"))).toEqual([]);
	});

	it("accepts a partial result when the success ratio meets the threshold, with placeholders for failed pages", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 10, title: "Mostly OCR-able" }),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 7) return { ok: false, error: new Error("DeepInfra timed out") };
				return { ok: true, html: tesseractParagraph(`page-${pageIndices[0]}`) };
			},
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Mostly OCR-able");
		expect(result.html).toContain('<p class="ocr-tesseract">page-0</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">page-6</p>');
		expect(result.html).toContain('<p class="ocr-failed">[Page 8: OCR unavailable]</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">page-8</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">page-9</p>');
	});

	it("rejects when the success ratio is below the threshold", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] < 3) return { ok: false, error: new Error("DeepInfra timed out") };
				return { ok: true, html: tesseractParagraph(`page-${pageIndices[0]}`) };
			},
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR succeeded for 7 of 10 chunks — below 80% threshold" });
	});

	it("renders one placeholder per page for a multi-page chunk when overall ratio passes the threshold", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 10, title: "Multi-page chunks" }),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices.includes(4)) return { ok: false, error: new Error("DeepInfra timed out") };
				return { ok: true, html: pageIndices.map((i) => tesseractParagraph(`page-${i}`)).join("") };
			},
			batchSize: 2,
			partialSuccessThreshold: 0.5,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain('<p class="ocr-failed">[Page 5: OCR unavailable]</p>');
		expect(result.html).toContain('<p class="ocr-failed">[Page 6: OCR unavailable]</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">page-0</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">page-9</p>');
	});

	it("logs the failed page list when accepting a partial result", async () => {
		const warnings: string[] = [];
		const capturingLogger: HutchLogger = {
			info: () => {},
			error: () => {},
			warn: (msg) => { warnings.push(String(msg)); },
			debug: () => {},
		};
		const ocr = makeOcr({
			logger: capturingLogger,
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 3) return { ok: false, error: new Error("flaky page") };
				return { ok: true, html: tesseractParagraph(`page-${pageIndices[0]}`) };
			},
			batchSize: 1,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		const partialWarn = warnings.find((w) => w.includes("accepting partial result"));
		expect(partialWarn).toBeDefined();
		expect(partialWarn).toContain("9/10 chunks");
		expect(partialWarn).toContain("failed pages=[3]");
	});

	it("returns kind 'failed' when invokePageOcr throws an unexpected error rather than returning ok:false", async () => {
		const ocr = makeOcr({
			invokePageOcr: async () => { throw new Error("kaboom"); },
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: kaboom" });
	});

	it("honours an overridden partialSuccessThreshold", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 4, title: "Strict threshold" }),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 0) return { ok: false, error: new Error("nope") };
				return { ok: true, html: tesseractParagraph(`page-${pageIndices[0]}`) };
			},
			batchSize: 1,
			partialSuccessThreshold: 1.0,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR succeeded for 3 of 4 chunks — below 100% threshold" });
	});
});

describe("initOcrPdf — stage 1 LLM cleanup", () => {
	it("forwards each ok Tesseract chunk's extracted plain text to the cleanup Lambda", async () => {
		const cleanupCalls: Array<{ pageIndex: number; ocrText: string }> = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			invokePageOcr: stubInvokePageOcr((i) => `page-${i} text`),
			invokePageLlmCleanup: async (input) => {
				cleanupCalls.push({ pageIndex: input.pageIndex, ocrText: input.ocrText });
				return { ok: true, cleanedText: input.ocrText, applied: false };
			},
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(cleanupCalls.sort((a, b) => a.pageIndex - b.pageIndex)).toEqual([
			{ pageIndex: 0, ocrText: "page-0 text" },
			{ pageIndex: 1, ocrText: "page-1 text" },
		]);
	});

	it("uses the cleaned text in the final HTML when cleanup succeeds (applied=true)", async () => {
		const ocr = makeOcr({
			invokePageOcr: stubInvokePageOcr(() => "Vepository of records"),
			invokePageLlmCleanup: async ({ pageIndex }) => ({
				ok: true,
				cleanedText: "Repository of records",
				applied: true,
				pageIndex,
			}),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("Repository of records");
		expect(result.html).not.toContain("Vepository");
	});

	it("falls back to the Tesseract text when the cleanup Lambda invoke fails", async () => {
		const warnings: string[] = [];
		const capturingLogger: HutchLogger = {
			info: () => {},
			error: () => {},
			warn: (msg) => { warnings.push(String(msg)); },
			debug: () => {},
		};
		const ocr = makeOcr({
			logger: capturingLogger,
			invokePageOcr: stubInvokePageOcr(() => "original page text"),
			invokePageLlmCleanup: async () => ({ ok: false, error: new Error("DeepSeek 5xx") }),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("original page text");
		expect(warnings.some((w) => w.includes("cleanup invoke failed"))).toBe(true);
	});

	it("does NOT downgrade Tesseract partial-success accounting when cleanup fails on a successful chunk", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 5 }),
			invokePageOcr: stubInvokePageOcr((i) => `tesseract-${i}`),
			// Every cleanup invocation fails — but Tesseract succeeded on all 5
			// pages, so the document still completes fetched (cleanup falls back
			// to the Tesseract text). If cleanup failures counted against the
			// 80% partial-success threshold, this would fail the entire crawl.
			invokePageLlmCleanup: async () => ({ ok: false, error: new Error("DeepSeek down") }),
			batchSize: 1,
			partialSuccessThreshold: 0.8,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		// All 5 pages of Tesseract text survive in the final HTML.
		for (let i = 0; i < 5; i++) {
			expect(result.html).toContain(`tesseract-${i}`);
		}
	});

	it("caps cleanup-fanout concurrency to the configured cleanupConcurrency (lower than OCR's)", async () => {
		let inFlight = 0;
		let observedPeak = 0;
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			invokePageOcr: stubInvokePageOcr((i) => `t-${i}`),
			invokePageLlmCleanup: async ({ pageIndex, ocrText }) => {
				inFlight += 1;
				observedPeak = Math.max(observedPeak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight -= 1;
				return { ok: true, pageIndex, cleanedText: ocrText, applied: false };
			},
			cleanupConcurrency: 2,
			batchSize: 1,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(observedPeak).toBeLessThanOrEqual(2);
		expect(observedPeak).toBeGreaterThan(0);
	});
});

describe("initOcrPdf — stage 2 document diff review", () => {
	it("passes every successful page's original + cleaned text to the diff-review Lambda", async () => {
		const captured: Array<{ pageIndex: number; originalText: string; cleanedText: string }> = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			invokePageOcr: stubInvokePageOcr((i) => `original-${i}`),
			invokePageLlmCleanup: async ({ pageIndex, ocrText }) => ({
				ok: true,
				pageIndex,
				cleanedText: ocrText.replace("original", "cleaned"),
				applied: true,
			}),
			invokeDocumentDiffReview: async ({ pages }) => {
				captured.push(...pages);
				return {
					ok: true,
					applied: true,
					pages: pages.map((p) => ({ pageIndex: p.pageIndex, finalText: p.cleanedText })),
				};
			},
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(captured.sort((a, b) => a.pageIndex - b.pageIndex)).toEqual([
			{ pageIndex: 0, originalText: "original-0", cleanedText: "cleaned-0" },
			{ pageIndex: 1, originalText: "original-1", cleanedText: "cleaned-1" },
		]);
	});

	it("ships the diff-review final text per page in the assembled HTML", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			invokePageOcr: stubInvokePageOcr((i) => `staged-${i}`),
			invokeDocumentDiffReview: async ({ pages }) => ({
				ok: true,
				applied: true,
				pages: pages.map((p) => ({ pageIndex: p.pageIndex, finalText: `final-${p.pageIndex}` })),
			}),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain('<p class="ocr-tesseract">final-0</p>');
		expect(result.html).toContain('<p class="ocr-tesseract">final-1</p>');
	});

	it("falls back to stage-1 cleaned text when the diff-review Lambda invoke fails", async () => {
		const warnings: string[] = [];
		const capturingLogger: HutchLogger = {
			info: () => {},
			error: () => {},
			warn: (msg) => { warnings.push(String(msg)); },
			debug: () => {},
		};
		const ocr = makeOcr({
			logger: capturingLogger,
			invokePageOcr: stubInvokePageOcr(() => "tesseract page text"),
			invokePageLlmCleanup: async ({ pageIndex }) => ({
				ok: true,
				pageIndex,
				cleanedText: "cleaned-by-stage-1",
				applied: true,
			}),
			invokeDocumentDiffReview: async () => ({ ok: false, error: new Error("Lambda timed out") }),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("cleaned-by-stage-1");
		expect(warnings.some((w) => w.includes("diff-review invoke failed"))).toBe(true);
	});

	it("skips the diff-review invocation entirely when every Tesseract chunk failed (no pages to review)", async () => {
		let reviewCalls = 0;
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 5 }),
			invokePageOcr: async () => ({ ok: false, error: new Error("all failed") }),
			invokeDocumentDiffReview: async () => {
				reviewCalls += 1;
				return { ok: true, applied: false, pages: [] };
			},
			partialSuccessThreshold: 0.0,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(reviewCalls).toBe(0);
	});
});

describe("initOcrPdf — stage 3 semantic HTML conversion", () => {
	it("forwards Stage 2's per-page final text (not Stage 1's cleaned text) to the html-convert Lambda", async () => {
		const captured: Array<{ pageIndex: number; pageText: string }> = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			invokePageOcr: stubInvokePageOcr((i) => `tesseract-${i}`),
			invokePageLlmCleanup: async ({ pageIndex, ocrText }) => ({
				ok: true,
				pageIndex,
				cleanedText: `cleaned-${pageIndex}-from-${ocrText}`,
				applied: true,
			}),
			invokeDocumentDiffReview: async ({ pages }) => ({
				ok: true,
				applied: true,
				pages: pages.map((p) => ({ pageIndex: p.pageIndex, finalText: `final-${p.pageIndex}` })),
			}),
			invokePageHtmlConvert: async ({ pageIndex, pageText }) => {
				captured.push({ pageIndex, pageText });
				return { ok: true, pageIndex, semanticHtml: `<p>${pageText}</p>`, applied: true };
			},
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(captured.sort((a, b) => a.pageIndex - b.pageIndex)).toEqual([
			{ pageIndex: 0, pageText: "final-0" },
			{ pageIndex: 1, pageText: "final-1" },
		]);
	});

	it("ships the html-convert Lambda's semantic HTML in the assembled article body", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			invokePageOcr: stubInvokePageOcr((i) => `page-${i}`),
			invokePageHtmlConvert: async ({ pageIndex }) => ({
				ok: true,
				pageIndex,
				semanticHtml: `<h2>Page ${pageIndex}</h2><p>Body of page ${pageIndex}.</p>`,
				applied: true,
			}),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<h2>Page 0</h2>");
		expect(result.html).toContain("<p>Body of page 0.</p>");
		expect(result.html).toContain("<h2>Page 1</h2>");
	});

	it("falls back to <p class=\"ocr-tesseract\"> wrap of the Stage 2 final text when the html-convert invoke fails", async () => {
		const warnings: string[] = [];
		const capturingLogger: HutchLogger = {
			info: () => {},
			error: () => {},
			warn: (msg) => { warnings.push(String(msg)); },
			debug: () => {},
		};
		const ocr = makeOcr({
			logger: capturingLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			invokePageOcr: stubInvokePageOcr(() => "tesseract page text"),
			invokeDocumentDiffReview: async ({ pages }) => ({
				ok: true,
				applied: true,
				pages: pages.map((p) => ({ pageIndex: p.pageIndex, finalText: "post-stage-2 text" })),
			}),
			invokePageHtmlConvert: async () => ({ ok: false, error: new Error("Lambda timed out") }),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain('<p class="ocr-tesseract">post-stage-2 text</p>');
		expect(warnings.some((w) => w.includes("html-convert invoke failed"))).toBe(true);
	});

	it("strips dangerous tags from the final body via the document-level sanitiser", async () => {
		// Each per-page Stage 3 Lambda sanitises its own output, but the
		// orchestrator runs the sanitiser one more time over the stitched
		// body so any cross-boundary surprise (or a buggy fallback path
		// emitting a literal `<script>` tag) gets caught.
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			invokePageOcr: stubInvokePageOcr(() => "page text"),
			invokePageHtmlConvert: async ({ pageIndex }) => ({
				ok: true,
				pageIndex,
				semanticHtml: '<h2>safe</h2><script>alert(1)</script>',
				applied: true,
			}),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<h2>safe</h2>");
		expect(result.html).not.toContain("<script");
	});

	it("inserts <hr class=\"ocr-page-break\"> between adjacent chunk fragments (no leading or trailing rule)", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			invokePageOcr: stubInvokePageOcr((i) => `page-${i}`),
			invokePageHtmlConvert: async ({ pageIndex }) => ({
				ok: true,
				pageIndex,
				semanticHtml: `<p>page-${pageIndex}</p>`,
				applied: true,
			}),
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		// 3 page fragments → 2 page-break rules between them, none before or
		// after the document body.
		const matches = result.html.match(/<hr class="ocr-page-break">/g) ?? [];
		expect(matches).toHaveLength(2);
		const firstFragment = result.html.indexOf("page-0");
		const firstBreak = result.html.indexOf('<hr class="ocr-page-break">');
		expect(firstBreak).toBeGreaterThan(firstFragment);
	});

	it("emits no page-break rule for a single-page document", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			invokePageOcr: stubInvokePageOcr(() => "only page"),
			invokePageHtmlConvert: async ({ pageIndex }) => ({
				ok: true,
				pageIndex,
				semanticHtml: "<p>only page</p>",
				applied: true,
			}),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).not.toContain("ocr-page-break");
	});

	it("caps html-convert concurrency to the configured htmlConvertConcurrency", async () => {
		let inFlight = 0;
		let observedPeak = 0;
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			invokePageOcr: stubInvokePageOcr((i) => `t-${i}`),
			invokePageHtmlConvert: async ({ pageIndex }) => {
				inFlight += 1;
				observedPeak = Math.max(observedPeak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight -= 1;
				return { ok: true, pageIndex, semanticHtml: `<p>${pageIndex}</p>`, applied: true };
			},
			htmlConvertConcurrency: 2,
			batchSize: 1,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(observedPeak).toBeLessThanOrEqual(2);
		expect(observedPeak).toBeGreaterThan(0);
	});
});


describe("initOcrPdf — onPartialHtml streaming tap", () => {
	it("emits the in-order ready prefix as each chunk completes (out-of-order completions do not get surfaced ahead of their predecessors)", async () => {
		const completionOrder = [2, 0, 1, 4, 3];
		const completed: number[] = [];
		const partials: Array<{ html: string; readyPageCount: number }> = [];

		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 5 }),
			batchSize: 1,
			invokePageOcr: async ({ pageIndices }) => {
				const pageIndex = pageIndices[0];
				const order = completionOrder.indexOf(pageIndex);
				await new Promise((resolve) => setTimeout(resolve, (order + 1) * 5));
				completed.push(pageIndex);
				return { ok: true, html: tesseractParagraph(`page-${pageIndex}`) };
			},
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onPartialHtml: (p) => { partials.push({ html: p.html, readyPageCount: p.readyPageCount }); },
		});

		expect(completed).toEqual(completionOrder);

		// Collapse adjacent equal counts before asserting — the explicit
		// post-fan-out emission can repeat the last in-flight one.
		const distinctSteps = partials
			.map((p) => p.readyPageCount)
			.filter((count, idx, arr) => idx === 0 || arr[idx - 1] !== count);
		expect(distinctSteps).toEqual([1, 3, 5]);

		const pageMarkers = (html: string): number[] =>
			Array.from(html.matchAll(/page-(\d+)/g)).map((m) => Number(m[1])).sort();
		expect(pageMarkers(partials[0].html)).toEqual([0]);

		const threePagesReady = partials.find((p) => p.readyPageCount === 3);
		if (!threePagesReady) throw new Error("3-page prefix never emitted");
		expect(pageMarkers(threePagesReady.html)).toEqual([0, 1, 2]);

		const allReady = partials[partials.length - 1];
		expect(pageMarkers(allReady.html)).toEqual([0, 1, 2, 3, 4]);
	});

	it("inserts the page-break separator between adjacent fragments in the partial HTML", async () => {
		const partials: Array<{ html: string; readyPageCount: number }> = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			invokePageOcr: stubInvokePageOcr((i) => `page-${i}`),
			batchSize: 1,
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onPartialHtml: (p) => { partials.push({ html: p.html, readyPageCount: p.readyPageCount }); },
		});

		const allReady = partials[partials.length - 1];
		expect(allReady.html).toContain('<hr class="ocr-page-break">');
	});

	it("surfaces failed-chunk placeholders in the partial HTML so users see the gap immediately", async () => {
		const partials: Array<{ html: string; readyPageCount: number }> = [];
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			batchSize: 1,
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 1) return { ok: false, error: new Error("OCR exploded on page 2") };
				return { ok: true, html: tesseractParagraph(`page-${pageIndices[0]}`) };
			},
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onPartialHtml: (p) => { partials.push({ html: p.html, readyPageCount: p.readyPageCount }); },
		});

		const allReady = partials[partials.length - 1];
		expect(allReady.readyPageCount).toBe(3);
		expect(allReady.html).toContain("page-0");
		expect(allReady.html).toContain('<p class="ocr-failed">[Page 2: OCR unavailable]</p>');
		expect(allReady.html).toContain("page-2");
	});

	it("does not call onPartialHtml when the callback is omitted (zero behaviour change for non-streaming callers)", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			invokePageOcr: stubInvokePageOcr((i) => `page-${i}`),
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });
		expect(result.kind).toBe("fetched");
	});

	it("swallows errors thrown from the onPartialHtml callback so streaming failures never poison the crawl", async () => {
		const ocr = makeOcr({
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			invokePageOcr: stubInvokePageOcr((i) => `page-${i}`),
			batchSize: 1,
		});

		const result = await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onPartialHtml: () => { throw new Error("downstream throttle blew up"); },
		});
		expect(result.kind).toBe("fetched");
	});
});
