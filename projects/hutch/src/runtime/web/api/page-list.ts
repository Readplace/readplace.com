export type PageRel = "prev" | "current" | "next";

export interface PageListEntry {
	readonly label: string;
	readonly rel: PageRel;
	readonly href: string;
}

function relFor(pageNumber: number, currentPage: number): PageRel {
	if (pageNumber < currentPage) return "prev";
	return pageNumber === currentPage ? "current" : "next";
}

export function buildPageList(input: {
	currentPage: number;
	totalPages: number;
	hrefForPage: (pageNumber: number) => string;
}): PageListEntry[] {
	const lastPage = Math.max(input.totalPages, 1);
	const entries: PageListEntry[] = [];
	for (let pageNumber = 1; pageNumber <= lastPage; pageNumber++) {
		entries.push({
			label: String(pageNumber),
			rel: relFor(pageNumber, input.currentPage),
			href: input.hrefForPage(pageNumber),
		});
	}
	return entries;
}
