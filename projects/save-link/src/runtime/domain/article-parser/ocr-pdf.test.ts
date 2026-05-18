import type { PdfDocument, PdfRasterizer } from "@packages/crawl-article";
import { noopLogger } from "@packages/hutch-logger";
import { initOcrPdf } from "./ocr-pdf";

function stubRasterizer(params: {
	numPages: number;
	title?: string;
}): PdfRasterizer {
	let invocation = 0;
	return {
		async open(): Promise<PdfDocument> {
			return {
				numPages: params.numPages,
				loadPage() {
					invocation += 1;
					const pageNumber = invocation;
					return {
						// Embed call-order index as the PNG payload's last byte so
						// downstream batching assertions can recover page ordering.
						renderToPng: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, pageNumber]),
						destroy: () => {},
					};
				},
				getTitle: () => params.title,
				destroy: () => {},
			};
		},
	};
}

function rejectingRasterizer(reason: unknown): PdfRasterizer {
	return {
		async open(): Promise<PdfDocument> {
			throw reason;
		},
	};
}

describe("initOcrPdf — parallel batched OCR", () => {
	it("returns synthetic HTML stitched from vision fragments across all batches", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 7, title: "Scanned Document" }),
			createVisionMessage: async ({ images }) => `<p>text-for-${images.length}-pages</p>`,
			pagesPerBatch: 3,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/scan.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Scanned Document");
		expect(result.html).toContain("<title>Scanned Document</title>");
		expect(result.html).toContain("<h1>Scanned Document</h1>");
		expect(result.html).toContain("<p>text-for-3-pages</p>");
		expect(result.html).toContain("<p>text-for-1-pages</p>");
	});

	it("preserves structured HTML (headings, lists, tables) from the vision model verbatim", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1, title: "Structured" }),
			createVisionMessage: async () => "<h2>Section</h2><ul><li>one</li></ul><table><tr><td>cell</td></tr></table>",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<h2>Section</h2>");
		expect(result.html).toContain("<ul><li>one</li></ul>");
		expect(result.html).toContain("<td>cell</td>");
	});

	it("strips <script> and other dangerous elements from the vision response", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1, title: "Risky" }),
			createVisionMessage: async () => "<p>safe</p><script>alert(1)</script><iframe src=\"x\"></iframe>",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<p>safe</p>");
		expect(result.html).not.toContain("<script");
		expect(result.html).not.toContain("<iframe");
	});

	it("strips disallowed attributes (style, class, id, on*) while keeping href/src/alt/colspan/rowspan", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1, title: "Attrs" }),
			createVisionMessage: async () =>
				"<a href=\"https://example.com\" class=\"x\" onclick=\"x()\">link</a>" +
				"<img src=\"https://example.com/a.png\" alt=\"a\" style=\"x\">" +
				"<table><tr><td colspan=\"2\" id=\"y\">cell</td></tr></table>",
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

	it("strips <svg> and <math> elements from the vision response", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1, title: "SVG" }),
			createVisionMessage: async () =>
				"<p>safe</p><svg><foreignObject><div>xss</div></foreignObject></svg><math><mi>x</mi></math>",
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
			rasterizer: stubRasterizer({ numPages: 1, title: "Data" }),
			createVisionMessage: async () =>
				'<a href="data:text/html,<script>alert(1)</script>">click</a>' +
				'<img src="data:image/png;base64,abc" alt="img">',
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
			rasterizer: stubRasterizer({ numPages: 1, title: "JS" }),
			createVisionMessage: async () => "<a href=\"javascript:alert(1)\">click</a>",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).not.toContain("javascript:");
	});

	it("splits pages into batches of the configured size and issues parallel vision calls", async () => {
		const captured: number[][] = [];
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 13 }),
			createVisionMessage: async ({ images }) => {
				// Last byte of the PNG buffer carries the page number — see stubRasterizer.
				const pageNums = images
					.map((img) => img.pngBuffer[img.pngBuffer.length - 1])
					.filter((n): n is number => typeof n === "number");
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
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1 }),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/files/sample_doc.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("sample doc");
	});

	it("falls back to 'Untitled PDF' when neither metadata nor URL yields a slug", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1 }),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Untitled PDF");
	});

	it("falls back to 'Untitled PDF' when the URL cannot be parsed", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1 }),
			createVisionMessage: async () => "body text",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "::not a url::" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Untitled PDF");
	});

	it("returns kind 'failed' when the PDF exceeds the configured page cap", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 11 }),
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
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 5 }),
			createVisionMessage: async () => "   \n  ",
			pagesPerBatch: 5,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/blank.pdf" });

		expect(result).toEqual({
			kind: "failed",
			reason: "OCR returned no text across all batches",
		});
	});

	it("returns kind 'failed' wrapping the underlying error when the rasterizer throws", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: rejectingRasterizer(new Error("invalid pdf")),
			createVisionMessage: async () => "ignored",
		});

		const result = await ocr({ buffer: Buffer.from("not a pdf"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: invalid pdf" });
	});

	it("returns kind 'failed' wrapping the stringified value when the rasterizer throws a non-Error", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: rejectingRasterizer("opaque thrown"),
			createVisionMessage: async () => "ignored",
		});

		const result = await ocr({ buffer: Buffer.from("nope"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: opaque thrown" });
	});

	it("escapes HTML-significant characters in the title", async () => {
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 1, title: '"Risky" & <Funky>' }),
			createVisionMessage: async () => "<p>safe body</p>",
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("&quot;Risky&quot; &amp; &lt;Funky&gt;");
	});

	it("concatenates batch fragments in order (page-1 batch precedes page-2 batch in the output)", async () => {
		let invocation = 0;
		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer: stubRasterizer({ numPages: 6 }),
			createVisionMessage: async () => {
				invocation += 1;
				return `<p>batch-${invocation}</p>`;
			},
			pagesPerBatch: 3,
		});

		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		const firstIdx = result.html.indexOf("batch-1");
		const secondIdx = result.html.indexOf("batch-2");
		expect(firstIdx).toBeGreaterThan(-1);
		expect(secondIdx).toBeGreaterThan(firstIdx);
	});

	it("fires onProgress once per page with 1-based pageIndex and total pageCount", async () => {
		const progress: { pageIndex: number; pageCount: number }[] = [];
		const ocr = initOcrPdf({
			rasterizer: stubRasterizer({ numPages: 3 }),
			createVisionMessage: async () => "<p>text</p>",
		});

		await ocr({
			buffer: Buffer.from("%PDF"),
			url: "https://example.com/x.pdf",
			onProgress: (params) => { progress.push(params); },
		});

		expect(progress).toEqual([
			{ pageIndex: 1, pageCount: 3 },
			{ pageIndex: 2, pageCount: 3 },
			{ pageIndex: 3, pageCount: 3 },
		]);
	});

	it("destroys each PdfPage handle after rasterising it", async () => {
		const destroyed: number[] = [];
		let invocation = 0;
		const rasterizer: PdfRasterizer = {
			async open(): Promise<PdfDocument> {
				return {
					numPages: 3,
					loadPage() {
						invocation += 1;
						const pageId = invocation;
						return {
							renderToPng: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
							destroy: () => { destroyed.push(pageId); },
						};
					},
					getTitle: () => "T",
					destroy: () => {},
				};
			},
		};

		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer,
			createVisionMessage: async () => "body",
		});
		await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(destroyed).toEqual([1, 2, 3]);
	});

	it("destroys the PdfDocument handle even when the OCR pipeline throws after open", async () => {
		let docDestroyed = false;
		const rasterizer: PdfRasterizer = {
			async open(): Promise<PdfDocument> {
				return {
					numPages: 1,
					loadPage() {
						return {
							renderToPng: () => { throw new Error("render failure"); },
							destroy: () => {},
						};
					},
					getTitle: () => undefined,
					destroy: () => { docDestroyed = true; },
				};
			},
		};

		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer,
			createVisionMessage: async () => "ignored",
		});
		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: render failure" });
		expect(docDestroyed).toBe(true);
	});

	it("stringifies non-Error throws from the OCR pipeline after open", async () => {
		const rasterizer: PdfRasterizer = {
			async open(): Promise<PdfDocument> {
				return {
					numPages: 1,
					loadPage() {
						return {
							renderToPng: () => { throw "opaque render failure"; },
							destroy: () => {},
						};
					},
					getTitle: () => undefined,
					destroy: () => {},
				};
			},
		};

		const ocr = initOcrPdf({
			logger: noopLogger,
			rasterizer,
			createVisionMessage: async () => "ignored",
		});
		const result = await ocr({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR pipeline failed: opaque render failure" });
	});
});
