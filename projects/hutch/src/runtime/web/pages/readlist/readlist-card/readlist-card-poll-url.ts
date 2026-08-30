import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import type { ReadlistUrlState } from "../readlist.url";
import { tabQuery } from "../readlist.tabs";

/**
 * Polling URL for one card. The path takes the article id; the query
 * preserves the filter context (tab/order/page) of the parent /queue page so
 * that action forms inside the refreshed card still post back with the
 * filter-aware redirect query the user expects.
 *
 * The `tab=queue` and
 * default-order parameters are omitted because they are the implicit default,
 * keeping the polled URLs clean and stable across consecutive ticks.
 */
export function buildCardPollUrl(params: {
	articleId: string;
	pollCount: number;
	filters: Partial<ReadlistUrlState>;
}): string {
	const search = new URLSearchParams();
	search.set("poll", String(params.pollCount));
	if (params.filters.readlist && params.filters.readlist !== DEFAULT_READLIST_SLUG) {
		search.set("queue", params.filters.readlist);
	}
	const tab = params.filters.tab ?? "queue";
	if (tab !== "queue") search.set("tab", tab);
	const { defaultOrder } = tabQuery(tab);
	if (params.filters.order && params.filters.order !== defaultOrder) {
		search.set("order", params.filters.order);
	}
	if (params.filters.page && params.filters.page > 1) {
		search.set("page", String(params.filters.page));
	}
	return `/queue/${params.articleId}/card?${search.toString()}`;
}
