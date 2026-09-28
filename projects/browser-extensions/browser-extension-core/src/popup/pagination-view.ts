import type { PageDescriptor } from "../reading-list/reading-list.types";

interface PaginationPageView {
	readonly label: string;
	readonly index: number;
	readonly active: boolean;
}

/** A stand-in for the pages the window skipped, so a long list reads as
 * "1 … 4 5 6 … 50" rather than pretending those pages do not exist. */
interface PaginationGap {
	readonly gap: true;
}

export interface PaginationView {
	readonly hidden: boolean;
	readonly previous: number | undefined;
	readonly next: number | undefined;
	readonly pages: ReadonlyArray<PaginationPageView | PaginationGap>;
}

const PAGE_WINDOW = 1;

function indexesToShow(currentIndex: number, total: number): Set<number> {
	const shown = new Set<number>([0, total - 1]);
	for (let index = currentIndex - PAGE_WINDOW; index <= currentIndex + PAGE_WINDOW; index++) {
		if (index >= 0 && index < total) shown.add(index);
	}
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
