import type { ArticleStatus, ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";

export interface RelatedArticleLink {
	url: string;
	reason: string;
}

export type MarkRelatedArticlesOutcome = "stored" | "superseded";

export type MarkRelatedArticlesReady = (params: {
	userId: UserId;
	url: string;
	relatedArticles: readonly RelatedArticleLink[];
	inputTokens: number;
	outputTokens: number;
	at: Date;
}) => Promise<MarkRelatedArticlesOutcome>;

export type MarkRelatedArticlesSkipped = (params: {
	userId: UserId;
	url: string;
	at: Date;
}) => Promise<MarkRelatedArticlesOutcome>;

export interface RelatedArticleDisplay {
	id: ReaderArticleHashId;
	title: string;
	siteName: string;
	reason: string;
	status: ArticleStatus;
	savedAt: Date;
	readAt?: Date;
}

export type RelatedArticles =
	| { status: "pending" }
	| { status: "skipped" }
	| { status: "ready"; items: readonly RelatedArticleDisplay[] };

export type FindRelatedArticles = (params: {
	userId: UserId;
	url: string;
}) => Promise<RelatedArticles>;

export interface RelatedCandidate {
	url: string;
	title: string;
	siteName: string;
	description: string;
}

export type FindRelatedCandidateArticles = (params: {
	userId: UserId;
	excludeUrl: string;
	limit: number;
}) => Promise<readonly RelatedCandidate[]>;

export type FindRelatedReadCandidateArticles = (params: {
	userId: UserId;
	excludeUrl: string;
	limit: number;
}) => Promise<readonly RelatedCandidate[]>;

export interface RelatedTargetArticle {
	crawlStatus: "pending" | "ready" | "failed" | "unsupported" | undefined;
	title: string;
	siteName: string;
	description: string;
	hasStubMetadata: boolean;
}

export type FindRelatedTargetArticle = (
	url: string,
) => Promise<RelatedTargetArticle | undefined>;
