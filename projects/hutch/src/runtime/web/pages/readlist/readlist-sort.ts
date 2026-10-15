import type { SortOrder } from "@packages/provider-contracts/article-store";

const SORT_LABELS: Record<SortOrder, string> = {
	desc: "Newest first",
	asc: "Oldest first",
};

const SORT_ORDERS: readonly SortOrder[] = ["desc", "asc"];

export function sortLabel(order: SortOrder): string {
	return SORT_LABELS[order];
}

export const READLIST_SORT_OPTIONS: readonly { label: string; order: SortOrder }[] =
	SORT_ORDERS.map((order) => ({ label: sortLabel(order), order }));
