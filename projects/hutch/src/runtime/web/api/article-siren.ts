import { parseCrawlFailureReason } from "@packages/article-state-types";
import { displayableReadTime, type SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { SirenEntity, SirenLink, SirenMessage, SirenSubEntity } from "./siren";
import { type CollectionQueryParams, buildQueryString } from "./collection-query";

function needsBrowserCapture(crawl: ArticleCrawl | undefined): boolean {
	if (crawl?.status !== "failed") return false;
	const reason = parseCrawlFailureReason(crawl.reason);
	if (reason?.kind !== "blocked") return false;
	return reason.cause === "edge-block" || reason.cause === "rate-limited";
}

export function toArticleSubEntity(
	article: SavedArticle,
	options: { crawl?: ArticleCrawl; collectionQuery?: CollectionQueryParams } = {},
): SirenSubEntity {
	const id = article.id.value;
	const links: SirenLink[] = [
		{ rel: ["read"], title: "Read", href: `/queue/${id}/view` },
	];

	const isRead = article.status === "read";
	const targetStatus = isRead ? "unread" : "read";
	const readTime = displayableReadTime(article);

	return {
		class: ["article"],
		rel: ["item"],
		properties: {
			id,
			// Display: the redirect destination when this article was merged onto one,
			// else the saved URL. Navigation/mutation use `id`, so this is safe.
			url: article.displayUrl ?? article.url,
			title: article.metadata.title,
			siteName: article.metadata.siteName,
			excerpt: article.metadata.excerpt,
			imageUrl: article.metadata.imageUrl ?? null,
			estimatedReadTimeMinutes: readTime ? article.estimatedReadTime : null,
			readTime: readTime ?? null,
			status: article.status,
			savedAt: article.savedAt.toISOString(),
			readAt: article.readAt?.toISOString() ?? null,
			// An explicit presentational read-state so a client renders the read
			// indicator from one server-authored boolean rather than re-deriving it
			// from the `status` vocabulary it would otherwise have to hard-code.
			isRead,
			needsBrowserCapture: needsBrowserCapture(options.crawl),
		},
		links,
		actions: [
			{
				name: "update-status",
				title: isRead ? "Mark as unread" : "Mark as read",
				href: `/queue/${id}/status${buildQueryString(options.collectionQuery ?? {})}`,
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

/** The article a save just accepted, carrying what the client should tell the
 * reader and where it may send them next. The confirmation copy and the
 * onward affordance are server-authored so a client renders the outcome from
 * this response alone — it has no reason to fetch the collection, and none of
 * the wording lives in a shipped build. */
export function toSavedArticleEntity(params: {
	article: SavedArticle;
	createdUserArticle: boolean;
	wroteUserArticle: boolean;
}): SirenEntity {
	const entity = toArticleEntity(params.article);
	const messages: SirenMessage[] = params.createdUserArticle
		? [
				{ type: "success", content: { type: "text/html", body: "Article saved" } },
				{
					type: "success",
					content: { type: "text/html", body: "Saved to your reading list" },
				},
			]
		: [{ type: "success", content: { type: "text/html", body: "Already in your readlist" } }];
	if (!params.createdUserArticle && params.wroteUserArticle) {
		messages.push({
			type: "success",
			content: { type: "text/html", body: "Moved back to the top of your reading list" },
		});
	}
	return {
		...entity,
		properties: { ...entity.properties, messages },
		links: [
			...(entity.links ?? []),
			{ rel: ["collection"], title: "View Readlist", href: "/queue" },
		],
	};
}
