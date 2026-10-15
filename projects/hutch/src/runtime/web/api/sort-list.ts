import type { SortOrder } from "@packages/provider-contracts/article-store";

export type SortRel = "current" | "sort";

export interface SortOption {
	readonly label: string;
	readonly order: SortOrder;
}

export interface SortListEntry {
	readonly label: string;
	readonly rel: SortRel;
	readonly order: SortOrder;
	readonly href: string;
}

export function buildSortList(input: {
	options: readonly SortOption[];
	currentOrder: SortOrder;
	hrefForOrder: (order: SortOrder) => string;
}): SortListEntry[] {
	return input.options.map((option) => ({
		label: option.label,
		rel: option.order === input.currentOrder ? "current" : "sort",
		order: option.order,
		href: input.hrefForOrder(option.order),
	}));
}
