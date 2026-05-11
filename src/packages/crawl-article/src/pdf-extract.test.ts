import { initPdfExtract } from "./pdf-extract";
import type { PdfDocument, PdfjsLib, PdfPage } from "./pdf-extract.types";

function stubDocument(params: {
	pages: ReadonlyArray<ReadonlyArray<string>>;
	metadata?: Record<string, unknown>;
}): PdfDocument {
	return {
		numPages: params.pages.length,
		async getMetadata() {
			return { info: params.metadata ?? {} };
		},
		async getPage(pageNum) {
			const pageItems = params.pages[pageNum - 1] ?? [];
			const page: PdfPage = {
				async getTextContent() {
					return { items: pageItems.map((str) => ({ str })) };
				},
			};
			return page;
		},
	};
}

function stubPdfjsLib(doc: PdfDocument | (() => PdfDocument | Promise<PdfDocument>) | Error): PdfjsLib {
	return {
		getDocument() {
			if (doc instanceof Error) {
				return { promise: Promise.reject(doc) };
			}
			const resolver = typeof doc === "function" ? Promise.resolve(doc()) : Promise.resolve(doc);
			return { promise: resolver };
		},
	};
}

describe("initPdfExtract — text-layer extraction", () => {
	it("returns synthetic HTML with the PDF title and per-page paragraphs when text is present on every page", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(
				stubDocument({
					// Each inner array is the items pdfjs returns for a page; joined by " ".
					// Items with internal 2+ spaces create paragraph breaks in the synthetic output.
					pages: [
						["First paragraph on page one.", " ", "Second paragraph on page one."],
						["Sole paragraph on page two."],
					],
					metadata: { Title: "Sample Document" },
				}),
			),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4 dummy"), url: "https://example.com/doc.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Sample Document");
		expect(result.html).toContain("<title>Sample Document</title>");
		expect(result.html).toContain("<h1>Sample Document</h1>");
		expect(result.html).toMatch(/<article>.*<\/article>/);
		expect(result.html).toContain("<p>First paragraph on page one.</p>");
		expect(result.html).toContain("<p>Second paragraph on page one.</p>");
		expect(result.html).toContain("<p>Sole paragraph on page two.</p>");
	});

	it("derives a title from the URL filename when PDF metadata has no Title", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(stubDocument({ pages: [["Body"]], metadata: {} })),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/files/airmanship_good.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("airmanship good");
	});

	it("derives a title from the URL filename when PDF metadata Title is the empty string", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(stubDocument({ pages: [["Body"]], metadata: { Title: "   " } })),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/files/airmanship_good.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("airmanship good");
	});

	it("derives a title from the URL filename when metadata field is missing entirely", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib({
				numPages: 1,
				async getMetadata() {
					return {};
				},
				async getPage() {
					return {
						async getTextContent() {
							return { items: [{ str: "Body" }] };
						},
					};
				},
			}),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("x");
	});

	it("falls back to 'Untitled PDF' when the URL has no usable filename segment", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(stubDocument({ pages: [["Body"]], metadata: {} })),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Untitled PDF");
	});

	it("falls back to 'Untitled PDF' when the URL cannot be parsed", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(stubDocument({ pages: [["Body"]], metadata: {} })),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "not a real url" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("Untitled PDF");
	});

	it("ignores a non-string metadata Title", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(stubDocument({ pages: [["Body"]], metadata: { Title: 42 } })),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.title).toBe("x");
	});

	it("returns kind 'failed' with the scanned-PDF reason when every page has an empty text layer", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(stubDocument({ pages: [[""], ["  "], [""]], metadata: { Title: "Scanned" } })),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/scan.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "PDF has no extractable text layer" });
	});

	it("skips pages with empty text but succeeds when at least one page has content", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(stubDocument({ pages: [[""], ["content"], [""]], metadata: { Title: "Mixed" } })),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/mixed.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("<p>content</p>");
	});

	it("returns kind 'failed' carrying the underlying error message when pdfjs throws", async () => {
		const extract = initPdfExtract({ pdfjsLib: stubPdfjsLib(new Error("invalid PDF structure")) });

		const result = await extract({ buffer: Buffer.from("not a pdf"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "PDF parse failed: invalid PDF structure" });
	});

	it("returns kind 'failed' with the stringified value when pdfjs throws a non-Error", async () => {
		const extract = initPdfExtract({
			pdfjsLib: {
				getDocument() {
					return { promise: Promise.reject("string thrown") };
				},
			},
		});

		const result = await extract({ buffer: Buffer.from("not a pdf"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "PDF parse failed: string thrown" });
	});

	it("escapes HTML-significant characters in the title and the body", async () => {
		const extract = initPdfExtract({
			pdfjsLib: stubPdfjsLib(
				stubDocument({
					pages: [["<script>alert(1)</script>"]],
					metadata: { Title: '"Risky" & <Funky>' },
				}),
			),
		});

		const result = await extract({ buffer: Buffer.from("%PDF-1.4"), url: "https://example.com/x.pdf" });

		expect(result.kind).toBe("fetched");
		if (result.kind !== "fetched") return;
		expect(result.html).toContain("&quot;Risky&quot; &amp; &lt;Funky&gt;");
		expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(result.html).not.toContain("<script>alert(1)</script>");
	});
});
