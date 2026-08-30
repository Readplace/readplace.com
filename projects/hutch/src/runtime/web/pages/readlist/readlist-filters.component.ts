import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatTabCountLabel, render, withInternalTracking } from "@packages/web-shell";
import type { SortOrder } from "@packages/provider-contracts/article-store";

import type { ReadlistSlug } from "@packages/domain/readlist";
import { READLIST_TABS, type TabId, tabLabel } from "./readlist.tabs";
import { buildReadlistUrl } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-filters.template.html"), "utf-8");

export function filterLinkClass(isActive: boolean): string {
	return `readlist__filter-link${isActive ? " readlist__filter-link--active" : ""}`;
}

export function formatUnreadLabel(count: number): string {
	return formatTabCountLabel({ label: tabLabel("queue"), count });
}

export interface ReadlistFilterTab {
	linkClass: string;
	href: string;
	label: string;
	testFilter: string;
	isActive: boolean;
	labelId?: string;
	widestLabel?: string;
}

export interface ReadlistFiltersDisplayModel {
	tabs: readonly ReadlistFilterTab[];
}

export function buildReadlistFilters(input: {
	activeTab: TabId;
	order?: SortOrder;
	readlist?: ReadlistSlug;
}): ReadlistFiltersDisplayModel {
	return {
		tabs: READLIST_TABS.map((tab) => ({
			linkClass: filterLinkClass(tab.id === input.activeTab),
			href: withInternalTracking(
				buildReadlistUrl({ readlist: input.readlist, tab: tab.id, order: input.order }),
				{
					source: "queue-filters",
					content: tab.trackingContent,
				},
			),
			label: tab.label,
			testFilter: tab.testFilter,
			isActive: tab.id === input.activeTab,
			labelId: tab.labelId,
			widestLabel:
				tab.labelId === undefined ? undefined : formatUnreadLabel(Number.MAX_SAFE_INTEGER),
		})),
	};
}

export function renderReadlistFilters(displayModel: ReadlistFiltersDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
