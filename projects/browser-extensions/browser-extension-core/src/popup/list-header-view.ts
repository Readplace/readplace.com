import type { IconName } from "@packages/ui-icons";
import type {
	CollectionTotal,
	SortDescriptor,
	SortOrder,
} from "../reading-list/reading-list.types";

export interface ListHeaderView {
	readonly countLabel: string | null;
	readonly sort: {
		readonly label: string;
		readonly iconName: IconName;
		readonly toggleIndex: number;
	} | null;
}

const ICON_BY_ORDER: Record<SortOrder, IconName> = {
	desc: "arrow-down",
	asc: "arrow-up",
};

export function buildListHeaderView(page: {
	total: CollectionTotal | undefined;
	sort: SortDescriptor[];
}): ListHeaderView {
	const current = page.sort.find((entry) => entry.rel === "current");
	const toggleIndex = page.sort.findIndex((entry) => entry.rel !== "current");
	return {
		countLabel: page.total?.label ?? null,
		sort:
			current && toggleIndex !== -1
				? { label: current.label, iconName: ICON_BY_ORDER[current.order], toggleIndex }
				: null,
	};
}
