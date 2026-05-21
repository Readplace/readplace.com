import assert from "node:assert/strict";
import { noopLogger } from "@packages/hutch-logger";
import type { ExtractPdfMetadata } from "@packages/crawl-article";
import type { InvokePdfPageOcr, StagePdfToS3 } from "./pdf-page-ocr-invoker.types";
import { initSaveLinkPdfExtract } from "./init-save-link-pdf-extract";

describe("initSaveLinkPdfExtract", () => {
	it("wires the fan-out pipeline end-to-end and returns the joined HTML", async () => {
		const extractPdfMetadata: ExtractPdfMetadata = async () => ({ numPages: 2, title: "Scanned Doc" });
		const stagePdf: StagePdfToS3 = async () => ({
			key: "pdf-rasterise-staging/abc/source.pdf",
			cleanup: async () => {},
		});
		const invokePageOcr: InvokePdfPageOcr = async ({ pageIndices }) => ({
			html: pageIndices.map((idx) => `<p>page-${idx}</p>`).join(""),
		});

		const extractPdf = initSaveLinkPdfExtract({
			extractPdfMetadata,
			stagePdf,
			invokePageOcr,
			logger: noopLogger,
		});

		const result = await extractPdf({ buffer: Buffer.from("%PDF-"), url: "https://example.com/scan.pdf" });
		assert.equal(result.kind, "fetched");
		assert(result.kind === "fetched");
		assert.equal(result.title, "Scanned Doc");
		assert(result.html.includes("<p>page-0</p>"));
		assert(result.html.includes("<p>page-1</p>"));
	});
});
