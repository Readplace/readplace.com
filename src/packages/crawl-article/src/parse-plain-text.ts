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

export function parsePlainTextFromBuffer(input: {
	buffer: Buffer;
	bodyHash: string;
	response: Response;
	documentUrl: string;
}): CrawlArticleResult {
	const text = new TextDecoder().decode(input.buffer);
	const title = escapeHtmlText(deriveTitleFromTextUrl(input.documentUrl));
	const titleTag = title ? `<title>${title}</title>` : "";
	const h1 = title ? `<h1>${title}</h1>` : "";
	const html = `<!DOCTYPE html><html><head>${titleTag}</head><body><article>${h1}<pre><code>${escapeHtmlText(text)}</code></pre></article></body></html>`;
	return {
		status: "fetched",
		mediaType: "plain-text",
		plainText: text,
		html,
		etag: headerOrUndefined(input.response.headers, "etag"),
		lastModified: headerOrUndefined(input.response.headers, "last-modified"),
		bodyHash: input.bodyHash,
	};
}
