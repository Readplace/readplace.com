import type { ExtractPdf } from "@packages/crawl-article";
import { SCANNED_PDF_REASON } from "@packages/crawl-article";
import { initWithOcrFallback } from "./with-ocr-fallback";

describe("initWithOcrFallback", () => {
	it("returns the text-layer result without invoking OCR when extraction succeeds", async () => {
		const extractText: ExtractPdf = async () => ({ kind: "fetched", html: "<p>text</p>", title: "T" });
		const ocrPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const compose = initWithOcrFallback({ extractText, ocrPdf });

		const result = await compose({ buffer: Buffer.from("%PDF"), url: "https://example.com/x.pdf" });

		expect(result).toEqual({ kind: "fetched", html: "<p>text</p>", title: "T" });
		expect(ocrPdf).not.toHaveBeenCalled();
	});

	it("falls back to OCR when text-layer extraction reports the scanned-PDF reason", async () => {
		const extractText: ExtractPdf = async () => ({ kind: "failed", reason: SCANNED_PDF_REASON });
		const ocrPdf: ExtractPdf = async () => ({ kind: "fetched", html: "<p>ocr</p>", title: "Scanned" });
		const compose = initWithOcrFallback({ extractText, ocrPdf });

		const result = await compose({ buffer: Buffer.from("%PDF"), url: "https://example.com/scan.pdf" });

		expect(result).toEqual({ kind: "fetched", html: "<p>ocr</p>", title: "Scanned" });
	});

	it("surfaces non-scanned text-layer failures without invoking OCR", async () => {
		const extractText: ExtractPdf = async () => ({ kind: "failed", reason: "PDF parse failed: corrupted xref" });
		const ocrPdf = jest.fn<ReturnType<ExtractPdf>, Parameters<ExtractPdf>>();
		const compose = initWithOcrFallback({ extractText, ocrPdf });

		const result = await compose({ buffer: Buffer.from("%PDF"), url: "https://example.com/corrupt.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "PDF parse failed: corrupted xref" });
		expect(ocrPdf).not.toHaveBeenCalled();
	});

	it("returns the OCR failure when the scanned fallback also fails", async () => {
		const extractText: ExtractPdf = async () => ({ kind: "failed", reason: SCANNED_PDF_REASON });
		const ocrPdf: ExtractPdf = async () => ({ kind: "failed", reason: "OCR returned no text across all batches" });
		const compose = initWithOcrFallback({ extractText, ocrPdf });

		const result = await compose({ buffer: Buffer.from("%PDF"), url: "https://example.com/blank.pdf" });

		expect(result).toEqual({ kind: "failed", reason: "OCR returned no text across all batches" });
	});

	it("passes the original params through to OCR", async () => {
		const extractText: ExtractPdf = async () => ({ kind: "failed", reason: SCANNED_PDF_REASON });
		let capturedParams: { buffer: Buffer; url: string } | undefined;
		const ocrPdf: ExtractPdf = async (params) => {
			capturedParams = params;
			return { kind: "fetched", html: "<p>ok</p>", title: "ok" };
		};
		const compose = initWithOcrFallback({ extractText, ocrPdf });

		await compose({ buffer: Buffer.from("payload"), url: "https://example.com/p.pdf" });

		expect(capturedParams?.url).toBe("https://example.com/p.pdf");
		expect(capturedParams?.buffer.toString("utf8")).toBe("payload");
	});
});
