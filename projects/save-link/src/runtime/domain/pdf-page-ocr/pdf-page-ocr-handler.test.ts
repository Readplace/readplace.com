import { noopLogger } from "@packages/hutch-logger";
import type { RenderPdfPageToPng } from "@packages/crawl-article";
import type { CreateVisionMessage } from "../article-parser/create-deepinfra-vision-message";
import type { DownloadStagedPdf } from "./pdf-page-ocr-handler.types";
import { initPdfPageOcrHandler } from "./pdf-page-ocr-handler";

const stubDownload = (pdfBuffer: Buffer): DownloadStagedPdf => async () => pdfBuffer;
const stubRender = (png: Buffer): RenderPdfPageToPng => async () => png;
const stubVision = (html: string): CreateVisionMessage => async () => html;

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

	it("rejects malformed payloads via Zod (missing pdfS3Key)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			logger: noopLogger,
		});

		await expect(handler({ pageIndices: [0], dpi: 150 })).rejects.toThrow();
	});

	it("rejects malformed payloads via Zod (empty pageIndices)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [], dpi: 150 })).rejects.toThrow();
	});

	it("rejects malformed payloads via Zod (negative pageIndex in pageIndices)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [-1], dpi: 150 })).rejects.toThrow();
	});

	it("rejects malformed payloads via Zod (out-of-range dpi)", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.alloc(0)),
			renderPdfPageToPng: stubRender(Buffer.alloc(0)),
			createVisionMessage: stubVision("x"),
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
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [0], dpi: 150 })).rejects.toThrow("AccessDenied");
	});

	it("propagates errors from the rasterizer", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF")),
			renderPdfPageToPng: async () => { throw new Error("pdftoppm failed"); },
			createVisionMessage: stubVision("x"),
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [0], dpi: 150 })).rejects.toThrow("pdftoppm failed");
	});

	it("propagates errors from the vision model", async () => {
		const handler = initPdfPageOcrHandler({
			downloadStagedPdf: stubDownload(Buffer.from("%PDF")),
			renderPdfPageToPng: stubRender(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
			createVisionMessage: async () => { throw new Error("DeepInfra 429"); },
			logger: noopLogger,
		});

		await expect(handler({ pdfS3Key: "x", pageIndices: [0], dpi: 150 })).rejects.toThrow("DeepInfra 429");
	});
});
