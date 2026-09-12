import assert from "node:assert";
import {
	displayableReadTime,
	isNonArticleHost,
} from "@packages/domain/article";
import type { ArticleStatus, SavedArticle } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { AuthenticatedUserId } from "@packages/domain/user";
import type {
	FindArticlesByUser,
	FindReadlistArticles,
	ReadArticleContent,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
} from "@packages/provider-contracts/article-summary";
import type {
	FindRelatedArticles,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";
import type {
	ArticleRelatedResult,
	ArticleStatusResult,
	ArticleSummaryResult,
	McpArticle,
	McpReadlist,
	McpServerDeps,
} from "./mcp-server";

import type { ResolveOwnedArticle } from "./article-lookup";
import type { ResolveReadlistMembership } from "./readlist-membership";

interface McpArticleOperationDeps {
	resolveOwnedArticle: ResolveOwnedArticle;
	resolveReadlistMembership: ResolveReadlistMembership;
	findReadlistArticles: FindReadlistArticles;
	findArticlesByUser: FindArticlesByUser;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	findRelatedArticles: FindRelatedArticles;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
}

export function toMcpArticle(
	article: SavedArticle,
	readlists: readonly McpReadlist[],
): McpArticle {
	const readTime = displayableReadTime(article);
	return {
		id: article.id.value,
		readlists,
		url: article.displayUrl ?? article.url,
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		excerpt: article.metadata.excerpt,
		wordCount: article.metadata.wordCount,
		...(article.metadata.imageUrl !== undefined
			? { imageUrl: article.metadata.imageUrl }
			: {}),
		...(readTime !== undefined
			? { estimatedReadTime: article.estimatedReadTime, readTime }
			: {}),
		status: article.status,
		savedAt: article.savedAt.toISOString(),
		...(article.readAt !== undefined
			? { readAt: article.readAt.toISOString() }
			: {}),
	};
}

export function toSummaryResult(
	summary: GeneratedSummary | undefined,
): ArticleSummaryResult {
	// An absent summary row maps to `pending`, the same state the reader UI shows
	// for `undefined`. Every save primes a pending row, so `undefined` is the
	// pre-priming window — the MCP tool reports what the user's own reader would,
	// not a separate verdict.
	if (!summary) return { status: "pending" };
	switch (summary.status) {
		case "pending":
			return { status: "pending" };
		case "ready":
			return {
				status: "ready",
				summary: summary.summary,
				...(summary.excerpt !== undefined ? { excerpt: summary.excerpt } : {}),
			};
		case "failed":
			return { status: "failed", reason: summary.reason };
		case "skipped":
			return {
				status: "skipped",
				...(summary.reason !== undefined ? { reason: summary.reason } : {}),
			};
	}
}

function toRelatedResult(related: RelatedArticles): ArticleRelatedResult {
	switch (related.status) {
		case "pending":
			return { status: "pending" };
		case "skipped":
			return { status: "skipped" };
		case "ready":
			return {
				status: "ready",
				articles: related.items.map((item) => ({
					id: item.id.value,
					title: item.title,
					siteName: item.siteName,
					reason: item.reason,
					status: item.status,
					savedAt: item.savedAt.toISOString(),
					...(item.readAt !== undefined
						? { readAt: item.readAt.toISOString() }
						: {}),
				})),
			};
	}
}

export function initMcpArticleOperations(
	deps: McpArticleOperationDeps,
): Pick<
	McpServerDeps,
	| "listReadlist"
	| "getArticle"
	| "getArticleContent"
	| "getArticleSummary"
	| "getRelatedArticles"
	| "markAsRead"
	| "markAsUnread"
> {
	async function projectArticle(userId: AuthenticatedUserId, article: SavedArticle) {
		const membership = await deps.resolveReadlistMembership({ userId, urls: [article.url] });
		const readlists = membership.get(article.url);
		assert(readlists, "membership must include each requested URL");
		return toMcpArticle(article, readlists);
	}

	async function changeStatus({
		userId,
		id,
		status,
	}: {
		userId: AuthenticatedUserId;
		id: string;
		status: ArticleStatus;
	}): Promise<ArticleStatusResult> {
		const owned = await deps.resolveOwnedArticle({ userId, id });
		if (!owned) return { status: "not_found" };
		const { article, readlist } = owned;
		if (article.status === status) {
			return { status: "ok", article: await projectArticle(userId, article) };
		}
		const updated = await deps.updateArticleStatusAcrossReadlists({
			id: article.id,
			userId,
			addressed: readlist,
			status,
		});
		if (!updated) return { status: "not_found" };
		return { status: "ok", article: await projectArticle(userId, updated) };
	}

	return {
		listReadlist: async ({ userId, readlist = DEFAULT_READLIST_SLUG, status, sort, order, page, pageSize }) => {
			const query = {
				userId,
				status,
				sort,
				order,
				page,
				pageSize,
				excludeContent: true,
				includeTotal: true,
			};
			const result = await (readlist === DEFAULT_READLIST_SLUG
				? deps.findArticlesByUser(query)
				: deps.findReadlistArticles({ ...query, readlist }));
			assert(result.total !== undefined, "includeTotal query must return a total");
			const membership = await deps.resolveReadlistMembership({
				userId,
				urls: result.articles.map((article) => article.url),
			});
			return {
				total: result.total,
				page: result.page,
				pageSize: result.pageSize,
				articles: result.articles.map((article) => {
					const readlists = membership.get(article.url);
					assert(readlists, "membership must include each requested URL");
					return toMcpArticle(article, readlists);
				}),
			};
		},

		getArticle: async ({ userId, id }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			return owned ? projectArticle(userId, owned.article) : null;
		},

		getArticleContent: async ({ userId, id }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			if (!owned) return { status: "not_found" };
			const { article } = owned;
			if (isNonArticleHost(article.url)) return { status: "not_an_article" };
			const content = await deps.readArticleContent(article.url);
			return content === undefined
				? { status: "pending" }
				: { status: "ready", content };
		},

		getArticleSummary: async ({ userId, id }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			if (!owned) return { status: "not_found" };
			const { article } = owned;
			if (isNonArticleHost(article.url)) return { status: "not_an_article" };
			const summary = await deps.findGeneratedSummary(article.url);
			return toSummaryResult(summary);
		},

		getRelatedArticles: async ({ userId, id }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			if (!owned) return { status: "not_found" };
			if (owned.readlist !== DEFAULT_READLIST_SLUG) return { status: "skipped" };
			const { article } = owned;
			const related = await deps.findRelatedArticles({
				userId,
				url: article.url,
			});
			return toRelatedResult(related);
		},

		markAsRead: ({ userId, id }) => changeStatus({ userId, id, status: "read" }),

		markAsUnread: ({ userId, id }) =>
			changeStatus({ userId, id, status: "unread" }),
	};
}
