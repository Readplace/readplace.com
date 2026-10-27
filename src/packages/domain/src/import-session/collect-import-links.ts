import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { SaveArticleInputSchema } from "../article/article.schema";
import { MAX_URLS_PER_IMPORT } from "./import-session.schema";
import type { ImportLinksResult } from "./import-session.types";

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

		const identity = ArticleResourceUniqueId.parse(parsed.data.url).value;
		if (seen.has(identity)) continue;
		seen.add(identity);

		if (urls.length >= MAX_URLS_PER_IMPORT) {
			truncated = true;
			continue;
		}
		urls.push(parsed.data.url);
	}

	return { urls, truncated, totalFound: seen.size };
}
