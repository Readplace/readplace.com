import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatTabCountLabel, render, withInternalTracking } from "@packages/web-shell";
import type { SortOrder } from "@packages/provider-contracts/article-store";

import type { QueueTabLink } from "./queue-tab";
import { QUEUE_TABS, tabLabel } from "./queue.tabs";
import { buildQueueUrl } from "./queue.url";

const TEMPLATE = readFileSync(join(__dirname, "queue-filters.template.html"), "utf-8");

export function filterLinkClass(isActive: boolean): string {
	return `queue__filter-link${isActive ? " queue__filter-link--active" : ""}`;
}

export function formatUnreadLabel(count: number): string {
	return formatTabCountLabel({ label: tabLabel("queue"), count });
}

export interface QueueFilterTab {
	linkClass: string;
	href: string;
	label: string;
	testFilter: string;
	anchorId?: string;
	badgeLabel?: string;
}

export interface QueueFiltersDisplayModel {
	groups: ReadonlyArray<{ tabs: readonly QueueFilterTab[] }>;
}

export function buildQueueFilters(input: {
	activeTab: string;
	order?: SortOrder;
	feature?: string;
	extraTabs?: readonly QueueTabLink[];
}): QueueFiltersDisplayModel {
	const listingTabs: QueueFilterTab[] = QUEUE_TABS.map((tab) => ({
		linkClass: filterLinkClass(tab.id === input.activeTab),
		href: withInternalTracking(
			buildQueueUrl({ tab: tab.id, order: input.order, feature: input.feature }),
			{ source: "queue-filters", content: tab.trackingContent },
		),
		label: tab.label,
		testFilter: tab.testFilter,
		anchorId: tab.anchorId,
	}));

	const extraTabs = input.extraTabs ?? [];
	if (extraTabs.length === 0) return { groups: [{ tabs: listingTabs }] };

	return {
		groups: [
			{
				tabs: extraTabs.map((tab) => ({
					linkClass: filterLinkClass(tab.id === input.activeTab),
					href: tab.href,
					label: tab.label,
					testFilter: tab.id,
					badgeLabel: tab.badgeLabel,
				})),
			},
			{ tabs: listingTabs },
		],
	};
}

export function renderQueueFilters(displayModel: QueueFiltersDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
