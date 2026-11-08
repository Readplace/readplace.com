import type { Article } from "@packages/domain/article-aggregate";

export type RefreshRefusal = "purged" | "unsupported" | "row-newer";

export function refreshRefusalFor(params: { article: Article; messageFetchedAt: string }): RefreshRefusal | undefined {
	const { article, messageFetchedAt } = params;
	if (article.purgedAt !== undefined) return "purged";
	if (article.crawl.kind === "unsupported") return "unsupported";
	const baseline = article.freshness.contentFetchedAt || article.savedAt;
	if (baseline !== undefined && baseline > messageFetchedAt) return "row-newer";
	return undefined;
}
