import type {
	McpToolOutcome,
	McpUaClient,
} from "@packages/web-analytics";
import type { AuthenticatedUserId } from "@packages/domain/user";
import type {
	AnchorState,
	ArticleStatus,
	DisplayableReadTime,
	ArticleBody,
} from "@packages/domain/article";
import type {
	ReadlistSlug,
} from "@packages/domain/readlist";
import type {
	SortField,
	SortOrder,
} from "@packages/provider-contracts/article-store";
import type { ToolAccess, } from "./tool-access";
import type { LogError } from "@packages/logger";

export interface McpReadlist {
	readonly id: ReadlistSlug;
	readonly name: string;
}

type SaveLinkResult =
	| { readonly ok: true; readonly pending: true }
	| {
			readonly ok: true;
			readonly id: string;
			readonly title: string;
			readonly filedInto: readonly McpReadlist[];
		}
	| { readonly ok: false; readonly message: string };

/** One saved article as the article tools expose it: metadata only (the reader
 * HTML is fetched separately by `get_article_content`). Dates are ISO strings
 * so the structured payload is plain JSON. */
export interface McpArticle {
	readonly id: string;
	readonly url: string;
	readonly title: string;
	readonly siteName: string;
	readonly excerpt: string;
	readonly wordCount: number;
	readonly imageUrl?: string;
	readonly readTime?: DisplayableReadTime;
	readonly status: ArticleStatus;
	readonly savedAt: string;
	readonly publishedOn?: string;
	readonly readAt?: string;
	readonly readlists: readonly McpReadlist[];
}

export interface McpArticleOutput extends Omit<McpArticle, "url"> {
	readonly url: string;
}

export type CreateReadlistResult =
	| { readonly status: "created"; readonly readlist: McpReadlist }
	| { readonly status: "exists"; readonly readlist: McpReadlist }
	| { readonly status: "invalid_name" }
	| { readonly status: "reserved_name"; readonly readlist: McpReadlist }
	| { readonly status: "limit_reached"; readonly limit: number }
	| { readonly status: "access_denied"; readonly message: string };

export type AddToReadlistResult =
	| {
			readonly status: "filed";
			readonly readlist: McpReadlist;
			readonly article: McpArticle;
		}
	| {
			readonly status: "already_filed";
			readonly readlist: McpReadlist;
			readonly article: McpArticle;
		}
	| { readonly status: "article_not_found" }
	| { readonly status: "readlist_not_found" }
	| { readonly status: "invalid_name" }
	| { readonly status: "reserved_name"; readonly readlist: McpReadlist }
	| { readonly status: "limit_reached"; readonly limit: number }
	| { readonly status: "access_denied"; readonly message: string };

export type ArticleContentResult =
	| { readonly status: "ready"; readonly content: ArticleBody }
	| { readonly status: "pending" }
	| { readonly status: "not_an_article" }
	| { readonly status: "not_found" };

export interface RelatedArticleResult {
	readonly id: string;
	readonly title: string;
	readonly siteName: string;
	readonly reason: string;
	readonly status: ArticleStatus;
	readonly savedAt: string;
	readonly readAt?: string;
}

export interface RelatedArticleOutput extends RelatedArticleResult {
	readonly url: string;
}

export type ArticleRelatedResult =
	| { readonly status: "not_found" }
	| { readonly status: "pending" }
	| { readonly status: "skipped" }
	| {
			readonly status: "ready";
			readonly articles: readonly RelatedArticleResult[];
		};

export type ArticleSummaryResult =
	| { readonly status: "not_found" }
	| { readonly status: "not_an_article" }
	| { readonly status: "pending" }
	| {
			readonly status: "ready";
			readonly summary: string;
			readonly excerpt?: string;
		}
	| { readonly status: "failed"; readonly reason: string }
	| { readonly status: "skipped"; readonly reason?: string };

export type ArticleStatusResult =
	| { readonly status: "not_found" }
	| { readonly status: "ok"; readonly article: McpArticle };

export interface McpHighlight {
	readonly id: string;
	readonly quote: string;
	readonly note?: string;
	readonly state: AnchorState;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface McpHighlightOutput extends McpHighlight {
	readonly url: string;
}

type HighlightArticleUnavailable =
	| { readonly status: "not_found" }
	| { readonly status: "not_an_article" }
	| { readonly status: "pending" };

export type ListHighlightsResult =
	| HighlightArticleUnavailable
	| {
			readonly status: "ready";
			readonly articleId: string;
			readonly readlist: ReadlistSlug;
			readonly highlights: readonly McpHighlight[];
		};

export type CreateHighlightResult =
	| HighlightArticleUnavailable
	| {
			readonly status: "created" | "merged";
			readonly articleId: string;
			readonly readlist: ReadlistSlug;
			readonly highlight: McpHighlight;
		}
	| { readonly status: "quote_not_found" }
	| { readonly status: "quote_ambiguous"; readonly matches: number }
	| { readonly status: "too_long"; readonly limit: number }
	| { readonly status: "conflict" }
	| { readonly status: "access_denied"; readonly message: string };

export interface ListReadlistResult {
	readonly total: number;
	readonly page: number;
	readonly pageSize: number;
	readonly articles: readonly McpArticle[];
}

/** The domain operations the tools delegate to. The composition root wires
 * these to the same save/list/read/status pipeline the hypermedia `/queue` API
 * uses, so an MCP `save_link` and an extension save are the identical write, a
 * mark-read over MCP is the identical write to the one the readlist page makes,
 * and the read tools see exactly what the user's own readlist shows. */
export interface McpServerDeps {
	appOrigin: string;
	saveLink: (params: {
		userId: AuthenticatedUserId;
		url: string;
		readlists: readonly ReadlistSlug[];
		oauthClientId: string;
	}) => Promise<SaveLinkResult>;
	listReadlist: (params: {
		userId: AuthenticatedUserId;
		readlist?: ReadlistSlug;
		status?: ArticleStatus;
		sort?: SortField;
		order?: SortOrder;
		page?: number;
		pageSize?: number;
	}) => Promise<ListReadlistResult>;
	listReadlists: (params: {
		userId: AuthenticatedUserId;
	}) => Promise<readonly McpReadlist[]>;
	createReadlist: (params: {
		userId: AuthenticatedUserId;
		name: string;
	}) => Promise<CreateReadlistResult>;
	addToReadlist: (params: {
		userId: AuthenticatedUserId;
		id: string;
		target:
			| { readonly kind: "existing"; readonly readlist: ReadlistSlug }
			| { readonly kind: "create"; readonly name: string };
	}) => Promise<AddToReadlistResult>;
	getArticle: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<McpArticle | null>;
	getArticleContent: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleContentResult>;
	getArticleSummary: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleSummaryResult>;
	getRelatedArticles: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleRelatedResult>;
	markAsRead: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleStatusResult>;
	markAsUnread: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ArticleStatusResult>;
	listHighlights: (params: {
		userId: AuthenticatedUserId;
		id: string;
	}) => Promise<ListHighlightsResult>;
	createHighlight: (params: {
		userId: AuthenticatedUserId;
		id: string;
		quote: string;
		note?: string;
		textBefore?: string;
	}) => Promise<CreateHighlightResult>;
	resolveToolAccess: (userId: AuthenticatedUserId) => Promise<ToolAccess>;
	recordToolCall: RecordMcpToolCall;
	recordHandshake: RecordMcpHandshake;
	logError: LogError;
}

export interface McpToolCallRecord {
	readonly tool: string;
	readonly outcome: McpToolOutcome;
	readonly userId: AuthenticatedUserId;
	readonly oauthClientId: string;
	readonly submittedUrl?: string;
	readonly sortOrder?: SortOrder;
}

export type RecordMcpToolCall = (record: McpToolCallRecord) => void;

interface McpInitializeRecord {
	readonly method: "initialize";
	readonly userId: AuthenticatedUserId;
	readonly oauthClientId: string;
	readonly clientProtocolVersion: unknown;
	readonly clientName: string | undefined;
	readonly clientVersion: string | undefined;
}

interface McpToolsListRecord {
	readonly method: "tools/list";
	readonly userId: AuthenticatedUserId;
	readonly oauthClientId: string;
	readonly toolCount: number;
	readonly uaClient: McpUaClient;
}

export type McpHandshakeRecord = McpInitializeRecord | McpToolsListRecord;

export type RecordMcpHandshake = (record: McpHandshakeRecord) => void;

/** The authenticated caller a request runs as. */
export interface McpRequestContext {
	readonly userId: AuthenticatedUserId;
	readonly oauthClientId: string;
	readonly uaClient: McpUaClient;
	readonly recordSaveRefused: () => void;
}
