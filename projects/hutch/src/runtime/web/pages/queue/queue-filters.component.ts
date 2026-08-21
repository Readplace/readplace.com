import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatTabCountLabel, render, withInternalTracking } from "@packages/web-shell";
import type { SortOrder } from "@packages/provider-contracts/article-store";

import type { QueueSlug } from "@packages/domain/queue";
import { QUEUE_TABS, type TabId, tabLabel } from "./queue.tabs";
import { type LinkParams, buildQueueUrl } from "./queue.url";

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
	isActive: boolean;
	labelId?: string;
	widestLabel?: string;
}

export interface QueueFiltersDisplayModel {
	tabs: readonly QueueFilterTab[];
}

export function buildQueueFilters(input: {
	activeTab: TabId;
	order?: SortOrder;
	queue?: QueueSlug;
	linkParams?: LinkParams;
}): QueueFiltersDisplayModel {
	return {
		tabs: QUEUE_TABS.map((tab) => ({
			linkClass: filterLinkClass(tab.id === input.activeTab),
			href: withInternalTracking(
				buildQueueUrl({ queue: input.queue, tab: tab.id, order: input.order }, input.linkParams),
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

export function renderQueueFilters(displayModel: QueueFiltersDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
