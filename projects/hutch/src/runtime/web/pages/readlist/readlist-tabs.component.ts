import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { SortOrder } from "@packages/provider-contracts/article-store";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";

import { preferencesFeatureParams, preferencesUrl } from "./readlist-preferences-feature";
import { READLIST_TABS, type TabId, formatUnreadLabel } from "./readlist.tabs";
import { buildReadlistUrl } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-tabs.template.html"), "utf-8");

const TABS_SOURCE = "queue-filters";

export type ReadlistTabSelection = TabId | "preferences";

export interface ReadlistTab {
	linkClass: string;
	href: string;
	label: string;
	testFilter: string;
	isActive: boolean;
	labelId?: string;
	widestLabel: string;
}

export interface ReadlistTabsDisplayModel {
	tabs: readonly ReadlistTab[];
}

export function readlistTabLinkClass(isActive: boolean): string {
	return `readlist-tabs__link${isActive ? " readlist-tabs__link--active" : ""}`;
}

const PREFERENCES_TAB = {
	label: "Preferences",
	testFilter: "preferences",
	trackingContent: "filter-preferences",
};

function preferencesTabs(input: {
	activeTab: ReadlistTabSelection;
	readlist: ReadlistSlug;
	preferencesEnabled: boolean;
}): readonly ReadlistTab[] {
	if (!input.preferencesEnabled) return [];
	if (input.readlist === DEFAULT_READLIST_SLUG) return [];
	const isActive = input.activeTab === "preferences";
	return [
		{
			linkClass: readlistTabLinkClass(isActive),
			href: withInternalTracking(preferencesUrl({ slug: input.readlist, enabled: true }), {
				source: TABS_SOURCE,
				content: PREFERENCES_TAB.trackingContent,
			}),
			label: PREFERENCES_TAB.label,
			testFilter: PREFERENCES_TAB.testFilter,
			isActive,
			widestLabel: PREFERENCES_TAB.label,
		},
	];
}

export function buildReadlistTabs(input: {
	activeTab: ReadlistTabSelection;
	readlist: ReadlistSlug;
	order?: SortOrder;
	knownUnreadCount?: number;
	preferencesEnabled: boolean;
}): ReadlistTabsDisplayModel {
	return {
		tabs: [
			...READLIST_TABS.map((tab) => ({
				linkClass: readlistTabLinkClass(tab.id === input.activeTab),
				href: withInternalTracking(
					buildReadlistUrl(
						{ readlist: input.readlist, tab: tab.id, order: input.order },
						preferencesFeatureParams(input.preferencesEnabled),
					),
					{ source: TABS_SOURCE, content: tab.trackingContent },
				),
				label:
					tab.labelId !== undefined && input.knownUnreadCount !== undefined
						? formatUnreadLabel(input.knownUnreadCount)
						: tab.label,
				testFilter: tab.testFilter,
				isActive: tab.id === input.activeTab,
				labelId: tab.labelId?.(input.readlist),
				widestLabel:
					tab.labelId === undefined ? tab.label : formatUnreadLabel(Number.MAX_SAFE_INTEGER),
			})),
			...preferencesTabs(input),
		],
	};
}

export function renderReadlistTabs(displayModel: ReadlistTabsDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
