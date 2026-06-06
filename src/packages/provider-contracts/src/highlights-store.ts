import type { ReaderArticleHashId } from "@packages/domain/article";
import type { HighlightId } from "@packages/domain/highlight";
import type { UserId } from "@packages/domain/user";

export interface Highlight {
	id: HighlightId;
	userId: UserId;
	articleId: ReaderArticleHashId;
	quote: string;
	note: string;
	createdAt: Date;
}

export interface CreateHighlightParams {
	userId: UserId;
	articleId: ReaderArticleHashId;
	quote: string;
	note: string;
}

export type CreateHighlight = (params: CreateHighlightParams) => Promise<Highlight>;

export interface FindHighlightsByArticleParams {
	userId: UserId;
	articleId: ReaderArticleHashId;
}

export type FindHighlightsByArticle = (
	params: FindHighlightsByArticleParams,
) => Promise<Highlight[]>;

export interface DeleteHighlightParams {
	userId: UserId;
	articleId: ReaderArticleHashId;
	id: HighlightId;
}

export type DeleteHighlight = (params: DeleteHighlightParams) => Promise<boolean>;
