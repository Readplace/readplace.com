import type { Highlight, HighlightAnchorUpdate, HighlightId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";

export type ListArticleHighlights = (params: {
	userId: UserId;
	url: string;
}) => Promise<readonly Highlight[]>;

export type CreateHighlightOutcome =
	| { status: "created" | "merged"; highlight: Highlight; replacedIds: readonly HighlightId[] }
	| { status: "cancelled" };

export type CreateHighlight = (params: {
	userId: UserId;
	highlight: Highlight;
	replacedIds: readonly HighlightId[];
}) => Promise<CreateHighlightOutcome>;

export type DeleteHighlight = (params: {
	userId: UserId;
	url: string;
	highlightId: HighlightId;
}) => Promise<{ deleted: boolean }>;

export type DeleteArticleHighlights = (params: {
	userId: UserId;
	url: string;
}) => Promise<void>;

export type DeleteAllUserHighlights = (userId: UserId) => Promise<void>;

export interface UserHighlight {
	userId: UserId;
	highlight: Highlight;
}

export type ListHighlightsOfArticle = (url: string) => Promise<readonly UserHighlight[]>;

export type HighlightAnchor = HighlightAnchorUpdate;

export type WriteHighlightAnchorOutcome = { outcome: "written" | "deleted" | "stale" };

export type WriteHighlightAnchor = (params: {
	userId: UserId;
	url: string;
	highlightId: HighlightId;
	expectedRevision: number;
	anchor: HighlightAnchor;
}) => Promise<WriteHighlightAnchorOutcome>;

export type UpdateHighlightNote = (params: {
	userId: UserId;
	url: string;
	highlightId: HighlightId;
	note?: string;
	updatedAt: Date;
}) => Promise<{ updated: boolean; hadNote: boolean }>;
