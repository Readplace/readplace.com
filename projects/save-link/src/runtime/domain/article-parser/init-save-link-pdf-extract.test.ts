import assert from "node:assert/strict";
import type { PdfjsLib, PdfjsLibBase, PdfDocument, PdfPage } from "@packages/crawl-article";
import { initSaveLinkPdfExtract } from "./init-save-link-pdf-extract";
import type { RenderablePdfPage } from "./render-pdf-page";

function stubPdfjsLib(pageText: string): PdfjsLib {
	return {
		getDocument() {
			const page: PdfPage = {
				getTextContent: async () => ({ items: [{ str: pageText }] }),
			};
			const doc: PdfDocument = {
				numPages: 1,
				getMetadata: async () => ({ info: { Title: "Stub Title" } }),
				getPage: async () => page,
			};
			return { promise: Promise.resolve(doc) };
		},
	};
}

function stubPdfjsLibForRender(): PdfjsLibBase<RenderablePdfPage> {
	return {
		getDocument() {
			return { promise: Promise.resolve({ numPages: 0, getMetadata: async () => ({}), getPage: async () => ({}) as RenderablePdfPage }) };
		},
	};
}

const stubCanvas = () => ({
	width: 0,
	height: 0,
	getContext: () => ({}),
	toBuffer: () => Buffer.alloc(0),
});

describe("initSaveLinkPdfExtract", () => {
	it("lazy-loads pdfjs on first call and caches the extractor", async () => {
		let loadCount = 0;
		const extractPdf = initSaveLinkPdfExtract({
			createCanvas: stubCanvas,
			createChatCompletion: async () => ({ choices: [{ message: { content: "" } }] }),
			loadPdfjsLib: async () => { loadCount++; return stubPdfjsLib("hello world"); },
			loadPdfjsLibForRender: async () => { loadCount++; return stubPdfjsLibForRender(); },
		});

		await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/test.pdf" });
		assert.equal(loadCount, 2);

		await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/test.pdf" });
		assert.equal(loadCount, 2, "loaders should not be called again on second invocation");
	});

	it("extracts text from a PDF with a text layer", async () => {
		const extractPdf = initSaveLinkPdfExtract({
			createCanvas: stubCanvas,
			createChatCompletion: async () => ({ choices: [{ message: { content: "" } }] }),
			loadPdfjsLib: async () => stubPdfjsLib("Some PDF content"),
			loadPdfjsLibForRender: async () => stubPdfjsLibForRender(),
		});

		const result = await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/doc.pdf" });
		assert.equal(result.kind, "fetched");
		assert(result.kind === "fetched");
		assert.equal(result.title, "Stub Title");
		assert(result.html.includes("Some PDF content"));
	});

	it("falls back to OCR when text layer is empty", async () => {
		const extractPdf = initSaveLinkPdfExtract({
			createCanvas: stubCanvas,
			createChatCompletion: async () => ({ choices: [{ message: { content: "OCR extracted text" } }] }),
			loadPdfjsLib: async () => stubPdfjsLib(""),
			loadPdfjsLibForRender: async () => {
				const renderablePage: RenderablePdfPage = {
					getViewport: () => ({ width: 100, height: 100 }),
					render: () => ({ promise: Promise.resolve() }),
				};
				return {
					getDocument() {
						return {
							promise: Promise.resolve({
								numPages: 1,
								getMetadata: async () => ({ info: { Title: "Scanned Doc" } }),
								getPage: async () => renderablePage,
							}),
						};
					},
				};
			},
		});

		const result = await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/scan.pdf" });
		assert.equal(result.kind, "fetched");
		assert(result.kind === "fetched");
		assert(result.html.includes("OCR extracted text"));
	});
});
