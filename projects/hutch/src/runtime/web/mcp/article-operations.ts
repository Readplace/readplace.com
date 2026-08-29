import assert from "node:assert";
import { ReaderArticleHashIdSchema, displayableReadTime } from "@packages/domain/article";
import type { ArticleStatus, SavedArticle } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { AuthenticatedUserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindArticlesByUser,
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
	McpServerDeps,
} from "./mcp-server";

interface McpArticleOperationDeps {
	findArticleById: FindArticleById;
	findArticlesByUser: FindArticlesByUser;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	findRelatedArticles: FindRelatedArticles;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
}

export function toMcpArticle(article: SavedArticle): McpArticle {
	const readTime = displayableReadTime(article);
	return {
		id: article.id.value,
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

/**
 * Builds the article-facing MCP operations from the same store seams the
 * hypermedia `/queue` API uses. Lives here rather than in the composition root
 * so the id→owner resolution and the metadata/summary mapping are unit-testable
 * without standing up the whole app. Every lookup — and the status write, which
 * resolves its target the same way — is owner-scoped (`findArticleById` is keyed
 * by userId), so a cross-user or malformed id resolves to "not found" rather
 * than reaching another user's article.
 */
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
	async function resolveOwned(
		userId: AuthenticatedUserId,
		id: string,
	): Promise<SavedArticle | null> {
		const parsed = ReaderArticleHashIdSchema.safeParse(id);
		if (!parsed.success) return null;
		return deps.findArticleById(parsed.data, userId);
	}

	/** Shared by both mark operations, which differ only in the status they land
	 * on. Re-reading the row first is what makes the write idempotent: the store
	 * restamps `readAt` on every write, so a second mark_as_read on an
	 * already-read article would move a date the caller was told wouldn't move. */
	async function changeStatus({
		userId,
		id,
		status,
	}: {
		userId: AuthenticatedUserId;
		id: string;
		status: ArticleStatus;
	}): Promise<ArticleStatusResult> {
		const article = await resolveOwned(userId, id);
		if (!article) return { status: "not_found" };
		if (article.status === status) {
			return { status: "ok", article: toMcpArticle(article) };
		}
		const updated = await deps.updateArticleStatusAcrossReadlists({
			id: article.id,
			userId,
			addressed: DEFAULT_READLIST_SLUG,
			status,
		});
		if (!updated) return { status: "not_found" };
		return { status: "ok", article: toMcpArticle(updated) };
	}

	return {
		listReadlist: async ({ userId, status, sort, order, page, pageSize }) => {
			const result = await deps.findArticlesByUser({
				userId,
				status,
				sort,
				order,
				page,
				pageSize,
				excludeContent: true,
				includeTotal: true,
			});
			assert(result.total !== undefined, "includeTotal query must return a total");
			return {
				total: result.total,
				page: result.page,
				pageSize: result.pageSize,
				articles: result.articles.map(toMcpArticle),
			};
		},

		getArticle: async ({ userId, id }) => {
			const article = await resolveOwned(userId, id);
			return article ? toMcpArticle(article) : null;
		},

		getArticleContent: async ({ userId, id }) => {
			const article = await resolveOwned(userId, id);
			if (!article) return { status: "not_found" };
			const content = await deps.readArticleContent(article.url);
			return content === undefined
				? { status: "pending" }
				: { status: "ready", content };
		},

		getArticleSummary: async ({ userId, id }) => {
			const article = await resolveOwned(userId, id);
			if (!article) return { status: "not_found" };
			const summary = await deps.findGeneratedSummary(article.url);
			return toSummaryResult(summary);
		},

		getRelatedArticles: async ({ userId, id }) => {
			const article = await resolveOwned(userId, id);
			if (!article) return { status: "not_found" };
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
