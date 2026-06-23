import type { SavedArticle } from "@packages/domain/article";
import type { SirenEntity, SirenLink, SirenSubEntity } from "./siren";

export function toArticleSubEntity(article: SavedArticle): SirenSubEntity {
	const id = article.id.value;
	const links: SirenLink[] = [
		{ rel: ["read"], href: `/queue/${id}/view` },
	];

	return {
		class: ["article"],
		rel: ["item"],
		properties: {
			id,
			url: article.url,
			title: article.metadata.title,
			siteName: article.metadata.siteName,
			excerpt: article.metadata.excerpt,
			wordCount: article.metadata.wordCount,
			imageUrl: article.metadata.imageUrl ?? null,
			estimatedReadTimeMinutes: article.estimatedReadTime,
			status: article.status,
			savedAt: article.savedAt.toISOString(),
			readAt: article.readAt?.toISOString() ?? null,
		},
		links,
		actions: [
			{
				name: "delete",
				href: `/queue/${id}/delete`,
				method: "POST",
			},
			{
				name: "update-status",
				href: `/queue/${id}/status`,
				method: "POST",
				type: "application/x-www-form-urlencoded",
				fields: [{ name: "status", type: "text" }],
			},
		],
	};
}

export function toArticleEntity(article: SavedArticle): SirenEntity {
	const { rel: _rel, ...entity } = toArticleSubEntity(article);
	return entity;
}
