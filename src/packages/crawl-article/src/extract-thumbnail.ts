import { parseHTML } from "linkedom";

/**
 * Single source of truth for picking the article's thumbnail URL out of
 * an HTML document. Every entry point that wants the imageUrl metadata
 * (server-side crawl, browser-extension raw-html save, stale-check
 * refresh) MUST go through this function so the cascade stays identical
 * across paths — see CLAUDE.md product constraints on the canonical
 * `og:image` → `twitter:image` → first `<img>` order.
 */
export function extractThumbnailCandidates(params: {
	html: string;
	baseUrl?: string;
}): string[] {
	const { html, baseUrl } = params;
	const { document } = parseHTML(html);
	const seen = new Set<string>();
	const candidates: string[] = [];

	function push(raw: string | null | undefined) {
		const resolved = resolveIfRelative(raw, baseUrl);
		if (resolved && isValidHttpUrl(resolved) && !seen.has(resolved)) {
			seen.add(resolved);
			candidates.push(resolved);
		}
	}

	push(document.querySelector('meta[property="og:image"]')?.getAttribute("content"));
	push(document.querySelector('meta[name="twitter:image"]')?.getAttribute("content"));
	for (const img of document.querySelectorAll("img[src]")) {
		push(img.getAttribute("src"));
	}

	return candidates;
}

/**
 * Returns the first thumbnail candidate or `null` when the document
 * exposes none. Returning `null` (not `undefined`) is deliberate — every
 * parseHtml caller is required to make an explicit thumbnail decision,
 * so the absence case is a value, not an omission.
 */
export function extractFirstThumbnailUrl(params: {
	html: string;
	baseUrl?: string;
}): string | null {
	return extractThumbnailCandidates(params)[0] ?? null;
}

function resolveIfRelative(
	url: string | null | undefined,
	baseUrl: string | undefined,
): string | undefined {
	if (!url) return undefined;
	if (isValidHttpUrl(url)) return url;
	if (!baseUrl) return url;
	try {
		return new URL(url, baseUrl).href;
	} catch {
		return url;
	}
}

function isValidHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}
