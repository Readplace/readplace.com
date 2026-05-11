import { initOcrPdf, type OcrPdfjsLib } from "./ocr-pdf";
import type { RenderablePdfPage, RenderPdfPage } from "./render-pdf-page";

function stubPage(): RenderablePdfPage {
	return {
		getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
		render: () => ({ promise: Promise.resolve() }),
	};
}

function stubPdfjsLib(params: {
	numPages: number;
	metadata?: Record<string, unknown>;
}): OcrPdfjsLib {
	return {
		getDocument: () => ({
			promise: Promise.resolve({
				numPages: params.numPages,
				async getMetadata() {
					return { info: params.metadata ?? {} };
				},
				async getPage() {
					return stubPage();
				},
			}),
		}),
	};
}

/**
 * The crawler calls `renderPage` sequentially in a `for (let pageNum = 1; …)`
 * loop. The stub embeds the call-order index as the PNG payload byte so that
 * the createVisionMessage stub can read images back and verify which page
 * numbers landed in which batch. Avoiding any tagging on the page object
 * keeps the type assertions clean.
 */
function stubRenderPage(): RenderPdfPage {
	let invocation = 0;
	return async () => {
		invocation += 1;
		return Buffer.from([0x89, 0x50, 0x4e, 0x47, invocation]);
	};
}

describe("initOcrPdf — parallel batched OCR", () => {
	it("returns synthetic HTML containing extracted text concatenated across all batches", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 7, metadata: { Title: "Scanned Document" } }),
			renderPage: stubRenderPage(),
			createVisionMessage: async ({ images }) => `text-for-${images.length}-pages`,
			pagesPerBatch: 3,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/scan.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Scanned Document");
		expect(result.html).toContain("<title>Scanned Document</title>");
		expect(result.html).toContain("<h1>Scanned Document</h1>");
		// 7 pages with batch size 3 → batches of 3, 3, 1 → three concatenated paragraphs.
		expect(result.html).toContain("<p>text-for-3-pages</p>");
		expect(result.html).toContain("<p>text-for-1-pages</p>");
	});

	it("splits pages into batches of the configured size and issues parallel vision calls", async () => {
		const captured: number[][] = [];
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 13 }),
			renderPage: stubRenderPage(),
			createVisionMessage: async ({ images }) => {
				// Last byte of the PNG buffer carries the page number — see stubRenderPage.
				const pageNums = images.map((img) => img.pngBuffer[img.pngBuffer.length - 1]).filter((n): n is number => typeof n === "number");
				captured.push(pageNums);
				return `batch-${pageNums.join("-")}`;
			},
			pagesPerBatch: 5,
		});

		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(captured).toEqual([
			[1, 2, 3, 4, 5],
			[6, 7, 8, 9, 10],
			[11, 12, 13],
		]);
	});

	it("derives a title from the URL filename when the PDF has no Title metadata", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 1, metadata: {} }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/files/sample_doc.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("sample doc");
	});

	it("derives a title from the URL filename when metadata Title is non-string", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 1, metadata: { Title: 42 } }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("x");
	});

	it("derives a title from the URL filename when metadata Title is whitespace only", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 1, metadata: { Title: "   " } }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("x");
	});

	it("falls back to 'Untitled PDF' when neither metadata nor URL yields a slug", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 1 }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Untitled PDF");
	});

	it("falls back to 'Untitled PDF' when the URL cannot be parsed", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 1 }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "::not a url::" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Untitled PDF");
	});

	it("returns kind 'failed' when the PDF exceeds the configured page cap", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 11 }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "ignored",
			maxPages: 10,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/huge.pdf" });

		expect(result).toEqual({
			kind: "failed",
			reason: "PDF too large for OCR fallback: 11 pages exceeds cap of 10",
		});
	});

	it("returns kind 'failed' when every batch returns empty text", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 5 }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "   \n  ",
			pagesPerBatch: 5,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/blank.pdf" });

		expect(result).toEqual({
			kind: "failed",
			reason: "OCR returned no text across all batches",
		});
	});

	it("returns kind 'failed' wrapping the underlying error when pdfjs throws", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: {
				getDocument: () => ({ promise: Promise.reject(new Error("invalid pdf")) }),
			},
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "ignored",
		});

		const result = await ocr({ buffer: Buffer.from("not a pdf"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: invalid pdf" });
	});

	it("returns kind 'failed' wrapping the stringified value when pdfjs throws a non-Error", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: {
				getDocument: () => ({ promise: Promise.reject("opaque thrown") }),
			},
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "ignored",
		});

		const result = await ocr({ buffer: Buffer.from("nope"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: opaque thrown" });
	});

	it("escapes HTML-significant characters in the title and OCR-extracted body", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 1, metadata: { Title: '"Risky" & <Funky>' } }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "<script>alert(1)</script>",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("&quot;Risky&quot; &amp; &lt;Funky&gt;");
		expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(result.html).not.toContain("<script>alert(1)</script>");
	});

	it("splits OCR body on blank lines so Readability sees discrete paragraphs", async () => {
		const ocr = initOcrPdf({
			pdfjsLib: stubPdfjsLib({ numPages: 1 }),
			renderPage: stubRenderPage(),
			createVisionMessage: async () => "first paragraph\n\nsecond paragraph",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<p>first paragraph</p>");
		expect(result.html).toContain("<p>second paragraph</p>");
	});
});
