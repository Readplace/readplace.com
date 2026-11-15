import assert from "node:assert/strict";
import { noopLogger } from "@packages/logger";
import type { ExtractPdfMetadata } from "@packages/crawl-article";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";
import type { InvokePdfPageLlmCleanup } from "./pdf-page-llm-cleanup-invoker.types";
import type { InvokePdfDocumentDiffReview } from "./pdf-document-diff-review-invoker.types";
import type { InvokePdfPageHtmlConvert } from "./pdf-page-html-convert-invoker.types";
import { initSaveLinkPdfExtract } from "./init-save-link-pdf-extract";
import { UserIdSchema } from "@packages/article-state-types";

const stubPageLlmCleanup: InvokePdfPageLlmCleanup = async ({ ocrText }) => ({
	ok: true,
	cleanedText: ocrText,
	applied: false,
	providerFailed: false,
});

const stubDocumentDiffReview: InvokePdfDocumentDiffReview = async ({ pages }) => ({
	ok: true,
	pages: pages.map((p) => ({ pageIndex: p.pageIndex, finalText: p.cleanedText })),
	applied: false,
	providerFailed: false,
});

const stubPageHtmlConvert: InvokePdfPageHtmlConvert = async ({ pageIndex, pageText }) => ({
	ok: true,
	pageIndex,
	semanticHtml: `<p class="ocr-tesseract">${pageText}</p>`,
	applied: false,
	providerFailed: false,
});

describe("initSaveLinkPdfExtract", () => {
	it("wires the fan-out pipeline end-to-end and returns the joined HTML", async () => {
		const extractPdfMetadata: ExtractPdfMetadata = async () => ({ numPages: 2, title: "Scanned Doc" });
		const stagePdf: StagePdfToS3 = async () => ({
			key: "pdf-rasterise-staging/abc/source.pdf",
			cleanup: async () => {},
		});
		const invokePageOcr: InvokePdfPageOcr = async ({ pageIndices }) => ({
			ok: true,
			html: pageIndices.map((idx) => `<p class="ocr-tesseract">page-${idx}</p>`).join(""),
		});

		const kept: string[] = [];
		const extractPdf = initSaveLinkPdfExtract({
			extractPdfMetadata,
			stagePdf,
			invokePageOcr,
			invokePageLlmCleanup: stubPageLlmCleanup,
			invokeDocumentDiffReview: stubDocumentDiffReview,
			invokePageHtmlConvert: stubPageHtmlConvert,
			findParsedPdf: async () => undefined,
			keepParsedPdf: async (parse) => { kept.push(parse.fileHash); },
			logger: noopLogger,
		});

		const result = await extractPdf({
			buffer: Buffer.from("%PDF-"),
			url: "https://example.com/scan.pdf",
			scope: { kind: "account", userId: UserIdSchema.parse("reader-1"), fileHash: "ef".repeat(32) },
			chargeOcrPages: async () => ({ allowed: true }),
		});
		assert.equal(result.kind, "fetched");
		assert(result.kind === "fetched");
		assert.equal(result.title, "Scanned Doc");
		assert(result.html.includes("page-0"));
		assert(result.html.includes("page-1"));
		assert.deepEqual(kept, ["ef".repeat(32)]);
	});
});
