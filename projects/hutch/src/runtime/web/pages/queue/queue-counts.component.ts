import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import { filterLinkClass, formatUnreadLabel } from "./queue.component";
import { buildQueueUrl } from "./queue.url";
import type { QueueUrlState } from "./queue.url";

const TEMPLATE = readFileSync(join(__dirname, "queue-counts.template.html"), "utf-8");

export interface QueueCountsDisplayModel {
	filterUnreadClass: string;
	filterUnreadUrl: string;
	filterUnreadLabel: string;
	showPageCount: boolean;
	currentPage: number;
	totalPages: number;
}

export function toQueueCountsDisplayModel(input: {
	filters: QueueUrlState;
	unreadCount: number;
	tabTotal: number;
	pageSize: number;
}): QueueCountsDisplayModel {
	const totalPages = Math.max(1, Math.ceil(input.tabTotal / input.pageSize));
	return {
		filterUnreadClass: filterLinkClass(input.filters.tab === "queue"),
		filterUnreadUrl: withInternalTracking(
			buildQueueUrl({ tab: "queue", order: input.filters.order }),
			{ source: "queue-filters", content: "filter-unread" },
		),
		filterUnreadLabel: formatUnreadLabel(input.unreadCount),
		showPageCount: totalPages > 1,
		currentPage: input.filters.page,
		totalPages,
	};
}

export function renderQueueCounts(displayModel: QueueCountsDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
