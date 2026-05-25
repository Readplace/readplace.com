import { noopLogger } from "@packages/hutch-logger";
import type { RenderPdfPageToPng } from "@packages/crawl-article";
import type { CreateVisionMessage } from "../article-parser/create-deepinfra-vision-message";
import type { DownloadStagedPdf, ExtractPageTextLayer } from "./pdf-page-ocr-handler.types";
import { initPdfPageOcrHandler } from "./pdf-page-ocr-handler";

const stubDownload = (pdfBuffer: Buffer): DownloadStagedPdf => async () => pdfBuffer;
const stubRender = (png: Buffer): RenderPdfPageToPng => async () => png;
const stubVision = (html: string): CreateVisionMessage => async () => html;
const stubTextLayer = (text: string): ExtractPageTextLayer => async () => ({ text });

describe("initPdfPageOcrHandler", () => {
	it("downloads the staged PDF, rasterises each requested page, OCRs the batch, and returns HTML", async () => {
		const renderedPages: number[] = [];
		const renderedDpis: number[] = [];
		let downloadKey: string | undefined;
		let visionImageCount = 0;
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: async ({ key }) => {
				downloadKey = key;
				return Buffer.from("%PDF-1.4");
			},
			renderPdfPageToPng: async ({ pageIndex, dpi }) => {
				renderedPages.push(pageIndex);
				renderedDpis.push(dpi);
				return Buffer.from([0x89, 0x50, 0x4e, 0x47, pageIndex]);
			},
			createVisionMessage: async ({ images }) => {
				visionImageCount = images.length;
				return "<p>hello</p>";
			},
			extractPageTextLayer: stubTextLayer(""),
			logger: noopLogger,
		});

		const result = await handler({
			pdfS3Key: "pdf-rasterise-staging/abc/source.pdf",
			pageIndices: [7, 8, 9],
			dpi: 150,
		});

		expect(result).toEqual({ html: "<p>hello</p>" });
		expect(downloadKey).toBe("pdf-rasterise-staging/abc/source.pdf");
		expect(renderedPages).toEqual([7, 8, 9]);
		expect(renderedDpis).toEqual([150, 150, 150]);
		expect(visionImageCount).toBe(3);
	});

	it("does NOT consult the text-layer when vision OCR succeeds", async () => {
		let textLayerCalled = 0;
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF-1.4")),
			renderPdfPageToPng: stubRender(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
			createVisionMessage: stubVision("<p>vision-html</p>"),
			extractPageTextLayer: async () => {
				textLayerCalled += 1;
				return { text: "shouldn't be reached" };
			},
			logger: noopLogger,
		});

		await handler({ pdfS3Key: "k", pageIndices: [0, 1, 2], dpi: 150 });

		expect(textLayerCalled).toBe(0);
	});

	it("rejects malformed payloads via Zod (missing pdfS3Key)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			extractPageTextLayer: stubTextLayer(""),
			logger: noopLogger,
		});

		await expect(handler({ pageIndices: [0], dpi: 150 })).rejects.toThrow();
	});

	it("rejects malformed payloads via Zod (empty pageIndices)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			extractPageTextLayer: stubTextLayer(""),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [], dpi: 150 })).rejects.toThrow();
	});

	it("rejects malformed payloads via Zod (negative pageIndex in pageIndices)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			extractPageTextLayer: stubTextLayer(""),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [-1], dpi: 150 })).rejects.toThrow();
	});

	it("rejects malformed payloads via Zod (out-of-range dpi)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			extractPageTextLayer: stubTextLayer(""),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [0], dpi: 50 })).rejects.toThrow();
		await expect(handler({ pdfS3Key: "x", pageIndices: [0], dpi: 9000 })).rejects.toThrow();
	});

	it("propagates errors from the S3 download", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: async () => { throw new Error("AccessDenied"); },
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			extractPageTextLayer: stubTextLayer(""),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [0], dpi: 150 })).rejects.toThrow("AccessDenied");
	});

	it("propagates errors from the rasterizer", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF")),
			renderPdfPageToPng: async () => { throw new Error("pdftoppm failed"); },
			createVisionMessage: stubVision("x"),
			extractPageTextLayer: stubTextLayer(""),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [0], dpi: 150 })).rejects.toThrow("pdftoppm failed");
	});

	it("falls back to the text layer when vision OCR throws", async () => {
		const visionError = new Error("Request timed out");
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF-1.4")),
			renderPdfPageToPng: stubRender(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
			createVisionMessage: async () => { throw visionError; },
			extractPageTextLayer: async ({ pageIndex }) => ({
				text: `Page ${pageIndex + 1} text\n\nSecond paragraph`,
			}),
			logger: noopLogger,
		});

		const result = await handler({ pdfS3Key: "k", pageIndices: [4], dpi: 150 });

		expect(result.html).toContain('<p class="ocr-text-layer">Page 5 text</p>');
		expect(result.html).toContain('<p class="ocr-text-layer">Second paragraph</p>');
	});

	it("rethrows the original vision error when the text-layer fallback is empty", async () => {
		const visionError = new Error("Request timed out");
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF-1.4")),
			renderPdfPageToPng: stubRender(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
			createVisionMessage: async () => { throw visionError; },
			extractPageTextLayer: stubTextLayer("    \n   \n  "),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "k", pageIndices: [0], dpi: 150 })).rejects.toBe(visionError);
	});

	it("rethrows the original vision error when text-layer extraction itself fails", async () => {
		/* A pdftotext crash is silently treated as empty (we don't want a noisy
		 * fallback to block the success path). When vision also fails, the
		 * empty fallback means we propagate the vision error. */
		const visionError = new Error("Request timed out");
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF-1.4")),
			renderPdfPageToPng: stubRender(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
			createVisionMessage: async () => { throw visionError; },
			extractPageTextLayer: async () => { throw new Error("pdftoppm crashed"); },
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "k", pageIndices: [0], dpi: 150 })).rejects.toBe(visionError);
	});

	it("escapes HTML-special characters in the text-layer fallback", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF-1.4")),
			renderPdfPageToPng: stubRender(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
			createVisionMessage: async () => { throw new Error("nope"); },
			extractPageTextLayer: stubTextLayer('Risky <script> & "end"'),
			logger: noopLogger,
		});

		const result = await handler({ pdfS3Key: "k", pageIndices: [0], dpi: 150 });

		expect(result.html).toContain("Risky &lt;script&gt; &amp; &quot;end&quot;");
		expect(result.html).not.toContain("<script>");
	});

	it("wraps each newline-separated paragraph of the text-layer fallback in its own <p>", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF-1.4")),
			renderPdfPageToPng: stubRender(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
			createVisionMessage: async () => { throw new Error("nope"); },
			extractPageTextLayer: stubTextLayer("First paragraph.\n\nSecond paragraph.\n\n\n\nThird paragraph."),
			logger: noopLogger,
		});

		const result = await handler({ pdfS3Key: "k", pageIndices: [0], dpi: 150 });

		expect(result.html).toBe(
			'<p class="ocr-text-layer">First paragraph.</p>' +
			'<p class="ocr-text-layer">Second paragraph.</p>' +
			'<p class="ocr-text-layer">Third paragraph.</p>',
		);
	});
});
