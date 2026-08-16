import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

import { formatUnreadLabel } from "./queue-filters.component";
import { UNREAD_LABEL_ID } from "./queue.tabs";
import type { QueueUrlState } from "./queue.url";

const TEMPLATE = readFileSync(join(__dirname, "queue-counts.template.html"), "utf-8");

export const UNREAD_BADGE_COUNT_LIMIT = 100;

export interface QueueCountsDisplayModel {
	unreadLabelId: string;
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
		unreadLabelId: UNREAD_LABEL_ID,
		filterUnreadLabel: formatUnreadLabel(input.unreadCount),
		showPageCount: totalPages > 1,
		currentPage: input.filters.page,
		totalPages,
	};
}

export function renderQueueCounts(displayModel: QueueCountsDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
