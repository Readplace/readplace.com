import type { PageDescriptor } from "../reading-list/reading-list.types";

export interface PaginationPageView {
	readonly label: string;
	readonly index: number;
	readonly active: boolean;
}

/** A stand-in for the pages the window skipped, so a long list reads as
 * "1 … 4 5 6 … 50" rather than pretending those pages do not exist. */
export interface PaginationGap {
	readonly gap: true;
}

export interface PaginationView {
	readonly hidden: boolean;
	readonly previous: number | undefined;
	readonly next: number | undefined;
	readonly pages: ReadonlyArray<PaginationPageView | PaginationGap>;
}

const MAX_VISIBLE_PAGES = 5;

function indexesToShow(currentIndex: number, total: number): Set<number> {
	const visible = Math.min(total, MAX_VISIBLE_PAGES);
	const start = Math.max(0, Math.min(currentIndex - Math.floor(visible / 2), total - visible));
	const shown = new Set<number>([0, total - 1]);
	for (let index = start; index < start + visible; index++) shown.add(index);
	return shown;
}

export function buildPaginationView(pages: PageDescriptor[]): PaginationView {
	if (pages.length <= 1) {
		return { hidden: true, previous: undefined, next: undefined, pages: [] };
	}
	const currentIndex = pages.findIndex((page) => page.rel === "current");
	const shown = indexesToShow(currentIndex, pages.length);
	const views: (PaginationPageView | PaginationGap)[] = [];
	let previousShown: number | undefined;
	pages.forEach((page, index) => {
		if (!shown.has(index)) return;
		if (previousShown !== undefined && index > previousShown + 1) views.push({ gap: true });
		views.push({ label: page.label, index, active: index === currentIndex });
		previousShown = index;
	});
	return {
		hidden: false,
		previous: currentIndex > 0 ? currentIndex - 1 : undefined,
		next: currentIndex >= 0 && currentIndex < pages.length - 1 ? currentIndex + 1 : undefined,
		pages: views,
	};
}
