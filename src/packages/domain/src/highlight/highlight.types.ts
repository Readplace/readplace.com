import type { UserId } from "../user/user.types";
import type { HighlightId } from "./highlight.schema";

export interface HighlightAnchor {
	readonly start: number;
	readonly end: number;
	readonly quote: string;
}

export interface Highlight {
	readonly id: HighlightId;
	readonly userId: UserId;
	/** The owning article's reader hash id (`ReaderArticleHashId.value`). */
	readonly articleId: string;
	readonly anchor: HighlightAnchor;
	readonly note?: string;
	readonly createdAt: string;
}

export type SaveHighlight = (params: {
	userId: UserId;
	articleId: string;
	anchor: HighlightAnchor;
	note?: string;
}) => Promise<Highlight>;

export type FindHighlightsByArticle = (params: {
	userId: UserId;
	articleId: string;
}) => Promise<readonly Highlight[]>;

export type UpdateHighlightNote = (params: {
	id: HighlightId;
	userId: UserId;
	articleId: string;
	note: string;
}) => Promise<void>;

export type DeleteHighlight = (params: {
	id: HighlightId;
	userId: UserId;
	articleId: string;
}) => Promise<void>;

export interface HighlightStore {
	saveHighlight: SaveHighlight;
	findHighlightsByArticle: FindHighlightsByArticle;
	updateHighlightNote: UpdateHighlightNote;
	deleteHighlight: DeleteHighlight;
}
