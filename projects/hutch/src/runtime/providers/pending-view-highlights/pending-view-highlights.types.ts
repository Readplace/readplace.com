export interface PendingViewHighlight {
	url: string;
	exact: string;
	prefix: string;
	suffix: string;
	note?: string;
}

export interface PendingViewHighlights {
	articleUrl: string;
	items: readonly PendingViewHighlight[];
}

export const PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS = 24 * 60 * 60;

export type StorePendingViewHighlights = (input: { pendingId: string } & PendingViewHighlights) => Promise<void>;

export type ClaimPendingViewHighlights = (pendingId: string) => Promise<PendingViewHighlights | undefined>;
