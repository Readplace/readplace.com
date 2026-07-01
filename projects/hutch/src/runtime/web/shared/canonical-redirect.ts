import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { GlobalArticleData } from "@packages/provider-contracts/article-store";

/**
 * Given the row loaded for a requested url, returns the canonical url the
 * reader should follow when that row is a canonical alias, or undefined when it
 * is not. An alias is a row whose `canonicalUrl` points at a *different* storage
 * identity than the row's own requested url; equal identities (or a missing
 * pointer) yield undefined so the caller renders the requested url in place.
 *
 * Cycle-safe by construction: the write path only ever stamps `canonicalUrl` on
 * the requested row, never on the canonical row it points at, so following the
 * pointer once always lands on a row without a pointer. Callers must not chain.
 */
export function canonicalRedirectTarget(params: {
	requestedUrl: string;
	article: GlobalArticleData | null;
}): string | undefined {
	const { requestedUrl, article } = params;
	if (!article?.canonicalUrl) return undefined;
	const differs =
		ArticleResourceUniqueId.parse(article.canonicalUrl).value !==
		ArticleResourceUniqueId.parse(requestedUrl).value;
	return differs ? article.canonicalUrl : undefined;
}
