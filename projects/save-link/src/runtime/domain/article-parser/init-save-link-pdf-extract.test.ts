import assert from "node:assert/strict";
import type { PdfDocument, PdfRasterizer } from "@packages/crawl-article";
import { noopLogger } from "@packages/hutch-logger";
import { initSaveLinkPdfExtract } from "./init-save-link-pdf-extract";

function stubRasterizer(params: { numPages: number; title?: string }): PdfRasterizer {
	return {
		async open(): Promise<PdfDocument> {
			return {
				numPages: params.numPages,
				loadPage() {
					return {
						renderToPng: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
						destroy: () => {},
					};
				},
				getTitle: () => params.title,
				destroy: async () => {},
			};
		},
	};
}

describe("initSaveLinkPdfExtract", () => {
	it("runs the vision OCR pipeline end-to-end and returns the rendered HTML", async () => {
		const extractPdf = initSaveLinkPdfExtract({
			rasterizer: stubRasterizer({ numPages: 1, title: "Scanned Doc" }),
			createChatCompletion: async () => ({ choices: [{ message: { content: "<h2>Heading</h2><p>body</p>" } }] }),
			logger: noopLogger,
		});

		const result = await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/scan.pdf" });
		assert.equal(result.kind, "fetched");
		assert(result.kind === "fetched");
		assert.equal(result.title, "Scanned Doc");
		assert(result.html.includes("<h2>Heading</h2>"));
		assert(result.html.includes("<p>body</p>"));
	});
});
