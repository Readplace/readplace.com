import {
	type ClaimPendingViewHighlights,
	PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS,
	type PendingViewHighlights,
	type StorePendingViewHighlights,
} from "./pending-view-highlights.types";

export function initInMemoryPendingViewHighlights(deps: { now: () => Date }): {
	storePendingViewHighlights: StorePendingViewHighlights;
	claimPendingViewHighlights: ClaimPendingViewHighlights;
} {
	const rows = new Map<string, PendingViewHighlights & { expiresAtMs: number }>();
	return {
		storePendingViewHighlights: async ({ pendingId, articleUrl, items }) => {
			rows.set(pendingId, {
				articleUrl,
				items,
				expiresAtMs: deps.now().getTime() + PENDING_VIEW_HIGHLIGHTS_TTL_SECONDS * 1000,
			});
		},
		claimPendingViewHighlights: async (pendingId) => {
			const row = rows.get(pendingId);
			rows.delete(pendingId);
			if (row === undefined || row.expiresAtMs <= deps.now().getTime()) return undefined;
			return { articleUrl: row.articleUrl, items: row.items };
		},
	};
}
