import type {
	ArticleStatus,
	SavedArticle,
} from "@packages/domain/article";
import type { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";

export interface SaveArticleParams {
	userId: UserId;
	url: string;
	metadata: SavedArticle["metadata"];
	estimatedReadTime: SavedArticle["estimatedReadTime"];
}

export type SortField = "savedAt" | "readAt";
export type SortOrder = "asc" | "desc";

export interface FindArticlesQuery {
	userId: UserId;
	status?: ArticleStatus;
	sort?: SortField;
	order?: SortOrder;
	page?: number;
	pageSize?: number;
	/** Skip the article body when reading rows. Use for list/export views that only need metadata. */
	excludeContent?: boolean;
}

export interface FindArticlesResult {
	articles: SavedArticle[];
	total: number;
	page: number;
	pageSize: number;
}

export type SaveArticle = (params: SaveArticleParams) => Promise<SavedArticle>;

export interface SaveArticleGloballyParams {
	url: string;
	metadata: SavedArticle["metadata"];
	estimatedReadTime: SavedArticle["estimatedReadTime"];
	savedAt: Date;
}

/** Returned `{ created }` lets the caller distinguish a fresh insert from a
 * no-op upsert on an existing row. The store performs the conditional put
 * only; whether to bump `savedAt` (or take any other follow-up) is a
 * domain decision the caller layers on top via `bumpArticleSavedAt`. */
export type SaveArticleGlobally = (
	params: SaveArticleGloballyParams,
) => Promise<{ created: boolean }>;

export interface BumpArticleSavedAtParams {
	url: string;
	savedAt: Date;
}

export type BumpArticleSavedAt = (
	params: BumpArticleSavedAtParams,
) => Promise<void>;

export type FindArticleById = (
	id: ReaderArticleHashId,
	userId: UserId,
) => Promise<SavedArticle | null>;

/** Resolve the original URL for a shared `/queue/<id>/view` permalink without
 * requiring the requester to own the article. Used to redirect non-owners
 * (anonymous or different account) to the public `/view/<url>` route. Returns
 * `null` when the hash doesn't match any saved article. */
export type FindArticleUrlById = (
	id: ReaderArticleHashId,
) => Promise<string | null>;

export interface GlobalArticleData {
	id: ReaderArticleHashId;
	url: string;
	metadata: SavedArticle["metadata"];
	estimatedReadTime: SavedArticle["estimatedReadTime"];
	savedAt: Date;
	contentSourceTier?: "tier-0" | "tier-1";
}

export type FindArticleByUrl = (
	url: string,
) => Promise<GlobalArticleData | null>;

export type FindArticlesByUser = (
	query: FindArticlesQuery,
) => Promise<FindArticlesResult>;

export type DeleteArticle = (
	id: ReaderArticleHashId,
	userId: UserId,
) => Promise<boolean>;

export type UpdateArticleStatus = (
	id: ReaderArticleHashId,
	userId: UserId,
	status: ArticleStatus,
) => Promise<boolean>;

export interface ArticleFreshnessData {
	etag?: string;
	lastModified?: string;
	contentFetchedAt?: string;
	/* SHA-256 of the previously-fetched body. Used by the stale-check chain
	 * to pre-parse-gate a refresh: if the new body hashes to the same value
	 * the parser is skipped entirely. */
	bodyHash?: string;
}

export type FindArticleFreshness = (
	url: string,
) => Promise<ArticleFreshnessData | null>;

