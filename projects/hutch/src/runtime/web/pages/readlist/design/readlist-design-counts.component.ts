import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

import { formatUnreadLabel } from "../readlist-filters.component";
import { unreadLabelId } from "../readlist.tabs";
import { type ReadlistUrlState, buildReadlistUrl } from "../readlist.url";
import { designFeatureParams } from "./readlist-design-feature";

const TEMPLATE = readFileSync(join(__dirname, "readlist-design-counts.template.html"), "utf-8");

const PAGE_WINDOW = 1;

export interface ReadlistDesignPageLink {
	number: number;
	label: string;
	href?: string;
	isCurrent: boolean;
	spanClass: string;
}

export interface ReadlistDesignCountsDisplayModel {
	unreadLabelId: string;
	filterUnreadLabel: string;
	countLabel: string;
	showingLabel: string;
	pages: readonly ReadlistDesignPageLink[];
}

export function savedArticlesLabel(total: number): string {
	return `${total} Saved Article${total === 1 ? "" : "s"}`;
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

function buildReadlistDesignPageLinks(input: {
	filters: ReadlistUrlState;
	totalPages: number;
}): ReadlistDesignPageLink[] {
	assert(input.totalPages >= 1, "a listing always has at least one page");
	const current = Math.min(input.filters.page, input.totalPages);
	const links: ReadlistDesignPageLink[] = [];
	let previous = 0;
	for (const number of pageNumbersToShow(current, input.totalPages)) {
		if (number - previous > 1) {
			links.push({ number: 0, label: "…", isCurrent: false, spanClass: "readlist-design__page-gap" });
		}
		const isCurrent = number === current;
		links.push({
			number,
			label: String(number),
			isCurrent,
			spanClass: "readlist-design__page readlist-design__page--current",
			...(isCurrent
				? {}
				: {
						href: withInternalTracking(
							buildReadlistUrl({ ...input.filters, page: number }, designFeatureParams(true)),
							{ source: "queue-pagination", content: `page-${number}` },
						),
					}),
		});
		previous = number;
	}
	return links;
}

export function toReadlistDesignCountsDisplayModel(input: {
	filters: ReadlistUrlState;
	unreadCount: number;
	tabTotal: number;
	pageSize: number;
}): ReadlistDesignCountsDisplayModel {
	const totalPages = Math.max(1, Math.ceil(input.tabTotal / input.pageSize));
	const current = Math.min(input.filters.page, totalPages);
	const rowsBefore = (current - 1) * input.pageSize;
	const rowsOnPage = Math.max(0, Math.min(input.pageSize, input.tabTotal - rowsBefore));
	return {
		unreadLabelId: unreadLabelId(input.filters.readlist),
		filterUnreadLabel: formatUnreadLabel(input.unreadCount),
		countLabel: savedArticlesLabel(input.tabTotal),
		showingLabel: showingLabel({ rowsOnPage, total: input.tabTotal }),
		pages: buildReadlistDesignPageLinks({ filters: input.filters, totalPages }),
	};
}

export function renderReadlistDesignCounts(displayModel: ReadlistDesignCountsDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
