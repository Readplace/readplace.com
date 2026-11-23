import type { SavedArticle } from "@packages/domain/article";

export function cardSuggestionLabel(article: Pick<SavedArticle, "provenance">): string | undefined {
	return article.provenance?.kind === "hn-suggestion" ? "Added by Readplace from Hacker News" : undefined;
}
