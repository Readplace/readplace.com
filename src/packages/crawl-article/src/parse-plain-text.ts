import type { CrawlArticleResult } from "./crawl-article.types";
import { headerOrUndefined } from "./header-utils";
import { escapeHtmlText } from "./pdf-html-helpers";

/**
 * Best-effort human title from the URL's last path segment: drop the file
 * extension and turn separators into spaces. Empty when the URL has no usable
 * segment, in which case the downstream Readability pass falls back to
 * "Article from {hostname}".
 */
function deriveTitleFromTextUrl(url: string): string {
	let pathname: string;
	try {
		pathname = new URL(url).pathname;
	} catch {
		return "";
	}
	const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
	return lastSegment.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
}

/**
 * Plain-text body → article result. Wraps the decoded text as a minimal
 * Readability-friendly document — a `<title>`/`<h1>` derived from the URL plus
 * one `<p>` per blank-line-separated block — so the shared downstream
 * Readability extractor handles it with no plain-text special case; prose
 * reflows to the reader's body width, which is the right default for a reader
 * view (intra-paragraph whitespace from monospaced sources is not preserved).
 */
export function parsePlainTextFromBuffer(input: {
	buffer: Buffer;
	bodyHash: string;
	response: Response;
	documentUrl: string;
}): CrawlArticleResult {
	const text = new TextDecoder().decode(input.buffer);
	const paragraphs = text
		.split(/\n\s*\n/)
		.map((block) => block.trim())
		.filter((block) => block.length > 0)
		.map((block) => `<p>${escapeHtmlText(block)}</p>`)
		.join("");
	const title = escapeHtmlText(deriveTitleFromTextUrl(input.documentUrl));
	const titleTag = title ? `<title>${title}</title>` : "";
	const h1 = title ? `<h1>${title}</h1>` : "";
	const html = `<!DOCTYPE html><html><head>${titleTag}</head><body><article>${h1}${paragraphs}</article></body></html>`;
	return {
		status: "fetched",
		html,
		etag: headerOrUndefined(input.response.headers, "etag"),
		lastModified: headerOrUndefined(input.response.headers, "last-modified"),
		bodyHash: input.bodyHash,
	};
}
