import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

import { formatUnreadLabel } from "./readlist-filters.component";
import { unreadLabelId } from "./readlist.tabs";
import type { ReadlistUrlState } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-counts.template.html"), "utf-8");

export const UNREAD_BADGE_COUNT_LIMIT = 100;

export interface ReadlistCountsDisplayModel {
	unreadLabelId: string;
	filterUnreadLabel: string;
	showPageCount: boolean;
	currentPage: number;
	totalPages: number;
}

export function toReadlistCountsDisplayModel(input: {
	filters: ReadlistUrlState;
	unreadCount: number;
	tabTotal: number;
	pageSize: number;
}): ReadlistCountsDisplayModel {
	const totalPages = Math.max(1, Math.ceil(input.tabTotal / input.pageSize));
	return {
		unreadLabelId: unreadLabelId(input.filters.readlist),
		filterUnreadLabel: formatUnreadLabel(input.unreadCount),
		showPageCount: totalPages > 1,
		currentPage: input.filters.page,
		totalPages,
	};
}

export function renderReadlistCounts(displayModel: ReadlistCountsDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
