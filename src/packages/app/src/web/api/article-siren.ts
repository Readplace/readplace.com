import type { SavedArticle } from "@packages/domain/article";
import type { SirenEntity, SirenLink, SirenSubEntity } from "./siren";

export function toArticleSubEntity(article: SavedArticle): SirenSubEntity {
	const id = article.id.value;
	const links: SirenLink[] = [
		{ rel: ["read"], href: `/queue/${id}/read` },
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
		],
	};
}

export function toArticleEntity(article: SavedArticle): SirenEntity {
	const { rel: _rel, ...entity } = toArticleSubEntity(article);
	return entity;
}
