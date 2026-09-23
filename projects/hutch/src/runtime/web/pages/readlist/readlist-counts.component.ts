import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import { renderReadlistTabTotal } from "./readlist-tab-total.component";
import { formatUnreadLabel, unreadLabelId } from "./readlist.tabs";
import { type ReadlistUrlState, buildReadlistUrl } from "./readlist.url";

const TEMPLATE = readFileSync(join(__dirname, "readlist-counts.template.html"), "utf-8");

export const UNREAD_BADGE_COUNT_LIMIT = 100;

const PAGE_WINDOW = 1;

export interface ReadlistPageLink {
	number: number;
	label: string;
	href?: string;
	isCurrent: boolean;
	spanClass: string;
}

export interface ReadlistCountsDisplayModel {
	unreadLabelId: string;
	filterUnreadLabel: string;
	countHtml: string;
	showingLabel: string;
	pages: readonly ReadlistPageLink[];
}

export function showingLabel(input: { rowsOnPage: number; total?: number }): string {
	return input.total === undefined
		? `Showing ${input.rowsOnPage}`
		: `Showing ${input.rowsOnPage} of ${input.total}`;
}

function pageNumbersToShow(current: number, totalPages: number): number[] {
	const wanted = new Set<number>([1, totalPages]);
	for (let page = current - PAGE_WINDOW; page <= current + PAGE_WINDOW; page += 1) {
		if (page >= 1 && page <= totalPages) wanted.add(page);
	}
	return [...wanted].sort((a, b) => a - b);
}

function buildReadlistPageLinks(input: {
	filters: ReadlistUrlState;
	totalPages: number;
}): ReadlistPageLink[] {
	assert(input.totalPages >= 1, "a listing always has at least one page");
	const current = Math.min(input.filters.page, input.totalPages);
	const links: ReadlistPageLink[] = [];
	let previous = 0;
	for (const number of pageNumbersToShow(current, input.totalPages)) {
		if (number - previous > 1) {
			links.push({ number: 0, label: "…", isCurrent: false, spanClass: "readlist__page-gap" });
		}
		const isCurrent = number === current;
		links.push({
			number,
			label: String(number),
			isCurrent,
			spanClass: "readlist__page readlist__page--current",
			...(isCurrent
				? {}
				: {
						href: withInternalTracking(
							buildReadlistUrl({ ...input.filters, page: number }),
							{ source: "queue-pagination", content: `page-${number}` },
						),
					}),
		});
		previous = number;
	}
	return links;
}

export function toReadlistCountsDisplayModel(input: {
	filters: ReadlistUrlState;
	unreadCount: number;
	tabTotal: number;
	pageSize: number;
}): ReadlistCountsDisplayModel {
	const totalPages = Math.max(1, Math.ceil(input.tabTotal / input.pageSize));
	const current = Math.min(input.filters.page, totalPages);
	const rowsBefore = (current - 1) * input.pageSize;
	const rowsOnPage = Math.max(0, Math.min(input.pageSize, input.tabTotal - rowsBefore));
	return {
		unreadLabelId: unreadLabelId(input.filters.readlist),
		filterUnreadLabel: formatUnreadLabel(input.unreadCount),
		countHtml: renderReadlistTabTotal({ tab: input.filters.tab, total: input.tabTotal, oob: true }),
		showingLabel: showingLabel({ rowsOnPage, total: input.tabTotal }),
		pages: buildReadlistPageLinks({ filters: input.filters, totalPages }),
	};
}

export function renderReadlistCounts(displayModel: ReadlistCountsDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
