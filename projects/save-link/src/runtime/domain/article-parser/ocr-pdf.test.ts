import { type HutchLogger, noopLogger } from "@packages/hutch-logger";
import type { ExtractPdfMetadata } from "@packages/crawl-article";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";
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

function stubInvokePageOcr(html: (pageIndex: number) => string): InvokePdfPageOcr {
	return async ({ pageIndices }) => ({
		ok: true,
		html: pageIndices.map((idx) => html(idx)).join(""),
	});
}

describe("initOcrPdf — fan-out per page Lambda", () => {
	it("returns synthetic HTML stitched from per-page invocation fragments", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 3, title: "Scanned Document" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr((i) => `<p>page-${i + 1}</p>`),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/scan.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Scanned Document");
		expect(result.html).toContain("<title>Scanned Document</title>");
		expect(result.html).toContain("<h1>Scanned Document</h1>");
		expect(result.html).toContain("<p>page-1</p>");
		expect(result.html).toContain("<p>page-2</p>");
		expect(result.html).toContain("<p>page-3</p>");
	});

	it("preserves structured HTML returned by the page Lambda verbatim", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1, title: "Structured" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "<h2>Section</h2><ul><li>one</li></ul><table><tr><td>cell</td></tr></table>"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<h2>Section</h2>");
		expect(result.html).toContain("<ul><li>one</li></ul>");
		expect(result.html).toContain("<td>cell</td>");
	});

	it("strips <script>, <iframe>, and other dangerous elements", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1, title: "Risky" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "<p>safe</p><script>alert(1)</script><iframe src=\"x\"></iframe>"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<p>safe</p>");
		expect(result.html).not.toContain("<script");
		expect(result.html).not.toContain("<iframe");
	});

	it("strips disallowed attributes while keeping href/src/alt/colspan/rowspan", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1, title: "Attrs" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() =>
				"<a href=\"https://example.com\" class=\"x\" onclick=\"x()\">link</a>" +
				"<img src=\"https://example.com/a.png\" alt=\"a\" style=\"x\">" +
				"<table><tr><td colspan=\"2\" id=\"y\">cell</td></tr></table>",
			),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain('href="https://example.com"');
		expect(result.html).toContain('src="https://example.com/a.png"');
		expect(result.html).toContain('alt="a"');
		expect(result.html).toContain('colspan="2"');
		expect(result.html).not.toContain('class="x"');
		expect(result.html).not.toContain('onclick');
		expect(result.html).not.toContain('style="x"');
		expect(result.html).not.toContain('id="y"');
	});

	it("strips <svg> and <math> from the page response", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1, title: "SVG" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() =>
				"<p>safe</p><svg><foreignObject><div>xss</div></foreignObject></svg><math><mi>x</mi></math>",
			),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<p>safe</p>");
		expect(result.html).not.toContain("<svg");
		expect(result.html).not.toContain("<math");
	});

	it("drops href and src values starting with data:", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1, title: "Data" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() =>
				'<a href="data:text/html,<script>alert(1)</script>">click</a>' +
				'<img src="data:image/png;base64,abc" alt="img">',
			),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).not.toContain("data:");
		expect(result.html).toContain('alt="img"');
	});

	it("drops href values starting with javascript:", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1, title: "JS" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "<a href=\"javascript:alert(1)\">click</a>"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).not.toContain("javascript:");
	});

	it("dispatches one invocation per chunk carrying the staged key, page indices, and DPI", async () => {
		const captured: Array<{ pdfS3Key: string; pageIndices: readonly number[]; dpi: number }> = [];
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 7 }),
			stagePdf: stubStagePdf({ key: "pdf-rasterise-staging/abc/source.pdf" }),
			invokePageOcr: async (input) => {
				captured.push({ pdfS3Key: input.pdfS3Key, pageIndices: input.pageIndices, dpi: input.dpi });
				return { ok: true, html: input.pageIndices.map((i) => `<p>p${i}</p>`).join("") };
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
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ dpi }) => {
				captured.push(dpi);
				return { ok: true, html: "<p>x</p>" };
			},
			dpi: 200,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(captured).toEqual([200]);
	});

	it("concatenates chunk fragments in chunk-dispatch order even when invocations complete out of order", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				const first = pageIndices[0];
				await new Promise((resolve) => setTimeout(resolve, (3 - first) * 5));
				return { ok: true, html: `<p>page-${first}</p>` };
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
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				inFlight += 1;
				observedPeak = Math.max(observedPeak, inFlight);
				await new Promise((resolve) => setTimeout(resolve, 5));
				inFlight -= 1;
				return { ok: true, html: `<p>${pageIndices[0]}</p>` };
			},
			concurrency: 3,
			batchSize: 1,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(observedPeak).toBeLessThanOrEqual(3);
		expect(observedPeak).toBeGreaterThan(0);
	});

	it("derives a title from the URL filename when the PDF has no Title metadata", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "body text"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/files/sample_doc.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("sample doc");
	});

	it("escapes HTML-significant characters in the title", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1, title: '"Risky" & <Funky>' }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "<p>safe body</p>"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("&quot;Risky&quot; &amp; &lt;Funky&gt;");
	});

	it("returns 'unsupported-large-file' when the PDF exceeds maxPages", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 11 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "ignored"),
			maxPages: 10,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/huge.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "unsupported-large-file" });
	});

	it("returns 'unsupported-large-file' when the PDF buffer exceeds maxPdfBytes", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "ignored"),
			maxPdfBytes: 10,
		});

		const result = await ocr({ buffer: Buffer.alloc(11), url: "https://example.com/huge.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "unsupported-large-file" });
	});

	it("returns kind 'failed' when every page returns empty text", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "   \n  "),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/blank.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR returned no text across all batches" });
	});

	it("returns kind 'failed' wrapping the underlying error when pdfinfo throws", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: async () => { throw new Error("invalid pdf"); },
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "ignored"),
		});

		const result = await ocr({ buffer: Buffer.from("not a pdf"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: invalid pdf" });
	});

	it("returns kind 'failed' stringifying a non-Error throw from pdfinfo", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: async () => { throw "opaque thrown"; },
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "ignored"),
		});

		const result = await ocr({ buffer: Buffer.from("nope"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: opaque thrown" });
	});

	it("returns kind 'failed' wrapping the underlying error when stagePdf throws", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			stagePdf: async () => { throw new Error("S3 PutObject denied"); },
			invokePageOcr: stubInvokePageOcr(() => "ignored"),
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: S3 PutObject denied" });
	});

	it("calls invokePageOcr exactly once per chunk before marking a failure (PAGE_OCR_MAX_ATTEMPTS=1)", async () => {
		const callsForFailingChunk: number[] = [];
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 1) {
					callsForFailingChunk.push(pageIndices[0]);
					return { ok: false, error: new Error("Lambda timed out") };
				}
				return { ok: true, html: `<p>${pageIndices[0]}</p>` };
			},
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		// 2 successes out of 3 chunks = 67%, below the default 80% threshold.
		expect(result).toEqual({ kind: "failed", reason: "OCR succeeded for 2 of 3 chunks — below 80% threshold" });
		// 1 attempt total; matches PAGE_OCR_MAX_ATTEMPTS in ocr-pdf.ts. The
		// per-page Lambda owns the recovery via its text-layer fallback, so
		// the orchestrator never re-invokes a chunk.
		expect(callsForFailingChunk).toEqual([1]);
	});

	it("keeps dispatching sibling chunks after one chunk fails", async () => {
		const seen: number[] = [];
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 5 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				const pageIndex = pageIndices[0];
				seen.push(pageIndex);
				if (pageIndex === 1) return { ok: false, error: new Error("page 2 failed") };
				return { ok: true, html: `<p>${pageIndex}</p>` };
			},
			concurrency: 1,
			batchSize: 1,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		// concurrency=1, batchSize=1: serial. Page 1 fails once (no retry under
		// PAGE_OCR_MAX_ATTEMPTS=1) and the captured failure (no throw) lets the
		// worker carry on with pages 2/3/4. Partial-success aggregation decides
		// whether the pipeline accepts the result.
		expect(seen).toEqual([0, 1, 2, 3, 4]);
	});

	it("calls staged.cleanup() after a successful fan-out", async () => {
		let cleanupCalls = 0;
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			stagePdf: stubStagePdf({ onCleanup: () => { cleanupCalls += 1; } }),
			invokePageOcr: stubInvokePageOcr(() => "<p>x</p>"),
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(cleanupCalls).toBe(1);
	});

	it("calls staged.cleanup() even when every page invocation fails", async () => {
		let cleanupCalls = 0;
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 2 }),
			stagePdf: stubStagePdf({ onCleanup: () => { cleanupCalls += 1; } }),
			invokePageOcr: async () => ({ ok: false, error: new Error("invoke failure") }),
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(cleanupCalls).toBe(1);
	});

	it("fires onProgress once per chunk completion with 1-based partIndex and total partCount (chunks, not pages)", async () => {
		const progress: { partIndex: number; partCount: number }[] = [];
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 6 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "<p>x</p>"),
			batchSize: 2,
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onProgress: (params) => { progress.push(params); },
		});

		// 6 pages / batchSize 2 = 3 chunks → 3 onProgress fires.
		expect(progress).toEqual([
			{ partIndex: 1, partCount: 3 },
			{ partIndex: 2, partCount: 3 },
			{ partIndex: 3, partCount: 3 },
		]);
	});

	it("fires partIndex in chunk-completion order (out-of-order chunks still increment partIndex monotonically)", async () => {
		const progress: { partIndex: number; partCount: number }[] = [];
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 3 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				const first = pageIndices[0];
				// Reverse the natural finish order so chunks complete later → earlier.
				await new Promise((resolve) => setTimeout(resolve, (3 - first) * 5));
				return { ok: true, html: `<p>${first}</p>` };
			},
			batchSize: 1,
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onProgress: (params) => { progress.push(params); },
		});

		expect(progress.map((p) => p.partIndex)).toEqual([1, 2, 3]);
		expect(progress.every((p) => p.partCount === 3)).toBe(true);
	});

	it("treats a zero-page PDF as failed (no fragments to join)", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 0 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: stubInvokePageOcr(() => "ignored"),
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
		const ocr = initOcrPdf({
			logger: capturingLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async () => ({ ok: false, error: new Error("nope") }),
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		// MAX_ATTEMPTS=1 means retriable never re-runs the chunk, so beforeRetry
		// never fires. The 1-chunk-all-failed case falls below the threshold
		// and returns failed, so no "accepting partial result" warn fires
		// either — leaving the warnings array empty.
		expect(warnings.filter((w) => w.includes("retrying"))).toEqual([]);
	});

	it("accepts a partial result when the success ratio meets the threshold, with placeholders for failed pages", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 10, title: "Mostly OCR-able" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 7) return { ok: false, error: new Error("DeepInfra timed out") };
				return { ok: true, html: `<p>page-${pageIndices[0]}</p>` };
			},
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Mostly OCR-able");
		expect(result.html).toContain("<p>page-0</p>");
		expect(result.html).toContain("<p>page-6</p>");
		expect(result.html).toContain('<p class="ocr-failed">[Page 8: OCR unavailable]</p>');
		expect(result.html).toContain("<p>page-8</p>");
		expect(result.html).toContain("<p>page-9</p>");
	});

	it("rejects when the success ratio is below the threshold", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] < 3) return { ok: false, error: new Error("DeepInfra timed out") };
				return { ok: true, html: `<p>page-${pageIndices[0]}</p>` };
			},
			batchSize: 1,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		// 7 ok / 10 = 70%, below the default 80% threshold.
		expect(result).toEqual({ kind: "failed", reason: "OCR succeeded for 7 of 10 chunks — below 80% threshold" });
	});

	it("renders one placeholder per page for a multi-page chunk when overall ratio passes the threshold", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 10, title: "Multi-page chunks" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices.includes(4)) return { ok: false, error: new Error("DeepInfra timed out") };
				return { ok: true, html: pageIndices.map((i) => `<p>page-${i}</p>`).join("") };
			},
			batchSize: 2,
			partialSuccessThreshold: 0.5,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		// Chunk pages=[4,5] failed → one placeholder per page in the chunk.
		expect(result.html).toContain('<p class="ocr-failed">[Page 5: OCR unavailable]</p>');
		expect(result.html).toContain('<p class="ocr-failed">[Page 6: OCR unavailable]</p>');
		// Sibling chunks still rendered as normal page text.
		expect(result.html).toContain("<p>page-0</p>");
		expect(result.html).toContain("<p>page-9</p>");
	});

	it("logs the failed page list when accepting a partial result", async () => {
		const warnings: string[] = [];
		const capturingLogger: HutchLogger = {
			info: () => {},
			error: () => {},
			warn: (msg) => { warnings.push(String(msg)); },
			debug: () => {},
		};
		const ocr = initOcrPdf({
			logger: capturingLogger,
			extractPdfMetadata: stubMetadata({ numPages: 10 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 3) return { ok: false, error: new Error("flaky page") };
				return { ok: true, html: `<p>page-${pageIndices[0]}</p>` };
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
		// The mapper captures `ok:false` results into ChunkOutcome, but a thrown
		// exception bypasses that path and surfaces through the outer try/catch
		// in initOcrPdf as a pipeline failure.
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 1 }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async () => { throw new Error("kaboom"); },
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: kaboom" });
	});

	it("honours an overridden partialSuccessThreshold", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			extractPdfMetadata: stubMetadata({ numPages: 4, title: "Strict threshold" }),
			stagePdf: stubStagePdf(),
			invokePageOcr: async ({ pageIndices }) => {
				if (pageIndices[0] === 0) return { ok: false, error: new Error("nope") };
				return { ok: true, html: `<p>page-${pageIndices[0]}</p>` };
			},
			batchSize: 1,
			partialSuccessThreshold: 1.0,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		// 3/4 = 75%, below the bumped 100% threshold. The default 80% would
		// also have failed this case, but the test still exercises the
		// override path because partialSuccessThreshold is read from deps.
		expect(result).toEqual({ kind: "failed", reason: "OCR succeeded for 3 of 4 chunks — below 100% threshold" });
	});
});
