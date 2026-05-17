import assert from "node:assert/strict";
import type { PdfjsLibBase } from "@packages/crawl-article";
import { initSaveLinkPdfExtract } from "./init-save-link-pdf-extract";
import type { RenderablePdfPage } from "./render-pdf-page";

function stubPdfjsLibForRender(params: { numPages: number; title?: string }): PdfjsLibBase<RenderablePdfPage> {
	const page: RenderablePdfPage = {
		getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
		render: () => ({ promise: Promise.resolve() }),
	};
	return {
		getDocument() {
			return {
				promise: Promise.resolve({
					numPages: params.numPages,
					getMetadata: async () => ({ info: { Title: params.title ?? "" } }),
					getPage: async () => page,
				}),
			};
		},
	};
}

const stubCanvas = () => ({
	width: 0,
	height: 0,
	getContext: () => ({
		drawImage: () => {},
		fillRect: () => {},
	}),
	toBuffer: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
});

describe("initSaveLinkPdfExtract", () => {
	it("lazy-loads pdfjs on first call and caches the extractor", async () => {
		let loadCount = 0;
		const extractPdf = initSaveLinkPdfExtract({
			createCanvas: stubCanvas,
			createChatCompletion: async () => ({ choices: [{ message: { content: "<p>ocr result</p>" } }] }),
			loadPdfjsLibForRender: async () => { loadCount++; return stubPdfjsLibForRender({ numPages: 1, title: "T" }); },
		});

		await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/test.pdf" });
		assert.equal(loadCount, 1);

		await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/test.pdf" });
		assert.equal(loadCount, 1, "loader should not be called again on second invocation");
	});

	it("runs the vision OCR pipeline end-to-end and returns the rendered HTML", async () => {
		const extractPdf = initSaveLinkPdfExtract({
			createCanvas: stubCanvas,
			createChatCompletion: async () => ({ choices: [{ message: { content: "<h2>Heading</h2><p>body</p>" } }] }),
			loadPdfjsLibForRender: async () => stubPdfjsLibForRender({ numPages: 1, title: "Scanned Doc" }),
		});

		const result = await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/scan.pdf" });
		assert.equal(result.kind, "fetched");
		assert(result.kind === "fetched");
		assert.equal(result.title, "Scanned Doc");
		assert(result.html.includes("<h2>Heading</h2>"));
		assert(result.html.includes("<p>body</p>"));
	});
});
