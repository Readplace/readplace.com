import type { SavedArticle } from "@packages/domain/article";
import type { SirenEntity, SirenLink, SirenSubEntity } from "./siren";

/** The hypermedia `rel` stays `read`; only the href varies, so swapping it is non-breaking. */
export type ReaderLinkPath = "view" | "app";

export function toArticleSubEntity(
	article: SavedArticle,
	options: { readerPath: ReaderLinkPath },
): SirenSubEntity {
	const id = article.id.value;
	const links: SirenLink[] = [
		{ rel: ["read"], title: "Read", href: `/queue/${id}/${options.readerPath}` },
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

export function toArticleEntity(
	article: SavedArticle,
	options: { readerPath: ReaderLinkPath },
): SirenEntity {
	const { rel: _rel, ...entity } = toArticleSubEntity(article, options);
	return entity;
}
