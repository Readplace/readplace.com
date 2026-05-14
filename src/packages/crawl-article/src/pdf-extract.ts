import type { ExtractPdf, PdfjsLib } from "./pdf-extract.types";
import { SCANNED_PDF_REASON, readMetaTitle, deriveTitleFromUrl, escapeHtmlText } from "./pdf-html-helpers";

export function initPdfExtract(deps: { pdfjsLib: PdfjsLib }): ExtractPdf {
	return async ({ buffer, url }) => {
		try {
			const data = new Uint8Array(buffer);
			const pdf = await deps.pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
			const pageTexts: string[] = [];
			for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
				const page = await pdf.getPage(pageNum);
				const textContent = await page.getTextContent();
				const text = textContent.items.map((item) => item.str ?? "").join(" ").trim();
				if (text) pageTexts.push(text);
			}
			if (pageTexts.length === 0) {
				return { kind: "failed", reason: SCANNED_PDF_REASON };
			}
			const meta = await pdf.getMetadata();
			const metaTitle = readMetaTitle(meta?.info);
			const title = metaTitle ?? deriveTitleFromUrl(url);
			return { kind: "fetched", html: buildSyntheticHtml({ title, pageTexts }), title };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { kind: "failed", reason: `PDF parse failed: ${message}` };
		}
	};
}

function buildSyntheticHtml(params: { title: string; pageTexts: readonly string[] }): string {
	const escapedTitle = escapeHtmlText(params.title);
	const body = params.pageTexts
		.map((pageText) => splitParagraphs(pageText).map((p) => `<p>${escapeHtmlText(p)}</p>`).join(""))
		.join("");
	return `<!DOCTYPE html><html><head><title>${escapedTitle}</title></head><body><article><h1>${escapedTitle}</h1>${body}</article></body></html>`;
}

/**
 * pdfjs joins text items on a page with spaces; the result has no paragraph
 * structure. Split on runs of 2+ spaces (heuristic for the gap between text
 * blocks in pdfjs output) so Readability sees discrete paragraphs.
 */
function splitParagraphs(pageText: string): string[] {
	return pageText.split(/\s{2,}/).map((s) => s.trim()).filter((s) => s.length > 0);
}
