import type { ExtractPdf, PdfjsLib } from "./pdf-extract.types";

/**
 * Text-layer extractor: open the PDF, pull `getTextContent()` for every page,
 * join the items, and wrap the result in a minimal HTML document that the
 * existing Readability pipeline already knows how to score. Title comes from
 * the PDF metadata's `/Title` entry; if absent we derive a slug from the URL
 * filename so the saved card still has a non-empty title.
 *
 * Returns `kind: "failed"` for PDFs whose text layer is empty across every
 * page (scanned/photographed documents). The composition root may wrap this
 * extractor in an OCR fallback; the wrapper is responsible for turning that
 * specific failure into a successful OCR call.
 */
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
				return { kind: "failed", reason: "PDF has no extractable text layer" };
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

function readMetaTitle(info: Record<string, unknown> | undefined): string | undefined {
	if (!info) return undefined;
	const title = info.Title;
	if (typeof title !== "string") return undefined;
	const trimmed = title.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function deriveTitleFromUrl(url: string): string {
	try {
		const { pathname } = new URL(url);
		const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
		const withoutExt = lastSegment.replace(/\.pdf$/i, "");
		const slugged = withoutExt.replace(/[_-]+/g, " ").trim();
		return slugged.length > 0 ? slugged : "Untitled PDF";
	} catch {
		return "Untitled PDF";
	}
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

function escapeHtmlText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

