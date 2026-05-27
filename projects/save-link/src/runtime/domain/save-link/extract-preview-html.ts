import assert from "node:assert";
import { parseHTML } from "linkedom";
import { escapeHtmlText } from "@packages/crawl-article";

const PREVIEW_TARGET_CHARS = 500;
const MAX_PARAGRAPHS = 3;

/**
 * Extract a tiny preview HTML fragment from raw fetched HTML — a `<h1>` with
 * the page title plus the first few paragraphs (~500 chars total). Used as
 * the very first streaming partial-content write so the reader sees a title
 * and a few sentences within the first second of a save, before the full
 * Readability pass completes.
 *
 * Pure function: deterministic on the input, no side effects. Returns an
 * empty string when neither a title nor any usable paragraphs can be found,
 * so the caller can skip a partial write that would yield no value.
 */
export function extractPreviewHtml(rawHtml: string): string {
	const { document } = parseHTML(rawHtml);
	const title = pickTitle(document);
	const paragraphs = pickParagraphs(document);
	if (!title && paragraphs.length === 0) return "";
	const titleHtml = title ? `<h1>${escapeHtmlText(title)}</h1>` : "";
	const bodyHtml = paragraphs
		.map((text) => `<p>${escapeHtmlText(text)}</p>`)
		.join("");
	return titleHtml + bodyHtml;
}

function pickTitle(document: Document): string {
	const ogTitle = document
		.querySelector('meta[property="og:title"]')
		?.getAttribute("content");
	if (ogTitle) return ogTitle.trim();
	const titleTag = document.querySelector("title")?.textContent;
	if (titleTag) return titleTag.trim();
	return "";
}

function pickParagraphs(document: Document): string[] {
	const all = Array.from(document.querySelectorAll("p"));
	const result: string[] = [];
	let totalChars = 0;
	for (const node of all) {
		if (result.length >= MAX_PARAGRAPHS) break;
		const raw = node.textContent;
		// DOM spec: Element.textContent is `string` (never null); the lib.dom
		// type widens to string|null for the base Node interface. assert keeps
		// the null branch out of V8 block coverage without lowering the threshold.
		assert(raw !== null, "Element.textContent must be a string");
		const text = raw.replace(/\s+/g, " ").trim();
		if (text.length === 0) continue;
		result.push(text);
		totalChars += text.length;
		if (totalChars >= PREVIEW_TARGET_CHARS) break;
	}
	return result;
}
