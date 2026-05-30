import { SaveArticleInputSchema } from "../article/article.schema";
import { MAX_URLS_PER_IMPORT } from "./import-session.schema";
import type { ImportLinksResult } from "./import-session.types";

function hasPathOrQueryOrHash(parsed: URL): boolean {
	if (parsed.pathname !== "/") return true;
	if (parsed.search) return true;
	if (parsed.hash) return true;
	return false;
}

function normalizeUrl(url: string): string {
	const parsed = new URL(url);
	parsed.hostname = parsed.hostname.toLowerCase();
	if (hasPathOrQueryOrHash(parsed)) return parsed.toString();
	return `${parsed.protocol}//${parsed.host}`;
}

function hasHttpScheme(raw: string): boolean {
	return /^https?:\/\//i.test(raw);
}

export function collectImportLinks(rawUrls: Iterable<string>): ImportLinksResult {
	const seen = new Set<string>();
	const urls: string[] = [];
	let truncated = false;

	for (const raw of rawUrls) {
		if (!hasHttpScheme(raw)) continue;

		const parsed = SaveArticleInputSchema.safeParse({ url: raw });
		if (!parsed.success) continue;

		const normalized = normalizeUrl(parsed.data.url);
		if (seen.has(normalized)) continue;
		seen.add(normalized);

		if (urls.length >= MAX_URLS_PER_IMPORT) {
			truncated = true;
			continue;
		}
		urls.push(parsed.data.url);
	}

	return { urls, truncated, totalFound: seen.size };
}
