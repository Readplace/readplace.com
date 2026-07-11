import type { SavedArticle } from "@packages/domain/article";
import type { SirenEntity, SirenLink, SirenSubEntity } from "./siren";

export function toArticleSubEntity(article: SavedArticle): SirenSubEntity {
	const id = article.id.value;
	const links: SirenLink[] = [
		{ rel: ["read"], title: "Read", href: `/queue/${id}/view` },
	];

	const isRead = article.status === "read";
	const targetStatus = isRead ? "unread" : "read";

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
			// An explicit presentational read-state so a client renders the read
			// indicator from one server-authored boolean rather than re-deriving it
			// from the `status` vocabulary it would otherwise have to hard-code.
			isRead,
		},
		links,
		actions: [
			{
				name: "update-status",
				title: isRead ? "Mark as unread" : "Mark as read",
				href: `/queue/${id}/status`,
				method: "POST",
				type: "application/x-www-form-urlencoded",
				fields: [{ name: "status", type: "text", value: targetStatus }],
			},
		],
	};
}

export function toArticleEntity(article: SavedArticle): SirenEntity {
	const { rel: _rel, ...entity } = toArticleSubEntity(article);
	return entity;
}
