import type { TabId } from "./readlist.tabs";

export function deriveKnownUnreadCount(input: {
	tab: TabId;
	hasMore: boolean;
	page: number;
	pageSize: number;
	rowsOnPage: number;
	readlistHoldsArticles: boolean;
}): number | undefined {
	if (!input.readlistHoldsArticles) return 0;
	if (input.tab !== "queue" || input.hasMore) return undefined;
	if (input.rowsOnPage === 0 && input.page > 1) return undefined;
	return (input.page - 1) * input.pageSize + input.rowsOnPage;
}
