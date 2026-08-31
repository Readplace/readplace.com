import assert from "node:assert";
import type { SavedArticle } from "@packages/domain/article";
import { type LocalTime, toRelativeOrDate } from "@packages/web-shell";
import { viewPathFor } from "../view/view-path";

export interface SharedLinkItem {
	title: string;
	href: string;
	sharedLabel: LocalTime;
}

export interface SharedLinksViewModel {
	items: SharedLinkItem[];
	hasItems: boolean;
}

export function buildSharedLinksViewModel(input: {
	articles: SavedArticle[];
	now: Date;
}): SharedLinksViewModel {
	const items: SharedLinkItem[] = input.articles.map((article) => {
		assert(article.sharedAt, "listSharedArticles only returns articles carrying a sharedAt");
		return {
			title: article.metadata.title,
			href: viewPathFor(article.url),
			sharedLabel: toRelativeOrDate({ iso: article.sharedAt.toISOString(), now: input.now }),
		};
	});
	return { items, hasItems: items.length > 0 };
}
