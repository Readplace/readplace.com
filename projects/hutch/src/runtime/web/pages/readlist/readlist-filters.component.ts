import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatTabCountLabel, render, withInternalTracking } from "@packages/web-shell";
import type { SortOrder } from "@packages/provider-contracts/article-store";

import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import { preferencesFeatureParams, preferencesUrl } from "./readlist-preferences-feature";
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

export type ReadlistFilterSelection = TabId | "preferences";

const PREFERENCES_FILTER = {
	label: "Preferences",
	testFilter: "preferences",
	trackingContent: "filter-preferences",
};

function preferencesFilterTabs(input: {
	activeTab: ReadlistFilterSelection;
	readlist: ReadlistSlug;
	preferencesEnabled: boolean;
}): readonly ReadlistFilterTab[] {
	if (!input.preferencesEnabled) return [];
	if (input.readlist === DEFAULT_READLIST_SLUG) return [];
	const isActive = input.activeTab === "preferences";
	return [
		{
			linkClass: filterLinkClass(isActive),
			href: withInternalTracking(
				preferencesUrl({ slug: input.readlist, enabled: true }),
				{
					source: "queue-filters",
					content: PREFERENCES_FILTER.trackingContent,
				},
			),
			label: PREFERENCES_FILTER.label,
			testFilter: PREFERENCES_FILTER.testFilter,
			isActive,
		},
	];
}

export function buildReadlistFilters(input: {
	activeTab: ReadlistFilterSelection;
	order?: SortOrder;
	readlist: ReadlistSlug;
	knownUnreadCount?: number;
	preferencesEnabled: boolean;
}): ReadlistFiltersDisplayModel {
	return {
		tabs: [
			...READLIST_TABS.map((tab) => ({
				linkClass: filterLinkClass(tab.id === input.activeTab),
				href: withInternalTracking(
					buildReadlistUrl(
						{ readlist: input.readlist, tab: tab.id, order: input.order },
						preferencesFeatureParams(input.preferencesEnabled),
					),
					{
						source: "queue-filters",
						content: tab.trackingContent,
					},
				),
				label:
					tab.labelId !== undefined && input.knownUnreadCount !== undefined
						? formatUnreadLabel(input.knownUnreadCount)
						: tab.label,
				testFilter: tab.testFilter,
				isActive: tab.id === input.activeTab,
				labelId: tab.labelId?.(input.readlist),
				widestLabel:
					tab.labelId === undefined ? undefined : formatUnreadLabel(Number.MAX_SAFE_INTEGER),
			})),
			...preferencesFilterTabs(input),
		],
	};
}

export function renderReadlistFilters(displayModel: ReadlistFiltersDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
