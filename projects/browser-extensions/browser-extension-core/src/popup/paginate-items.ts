interface PaginatedResult<T> {
	items: T[];
	currentPage: number;
	totalPages: number;
	visiblePages: number[];
}

const ITEMS_PER_PAGE = 10;
const MAX_VISIBLE_PAGES = 5;

export function paginateItems<T>(
	items: T[],
	page: number,
): PaginatedResult<T> {
	const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
	const currentPage = Math.max(1, Math.min(page, totalPages));

	const start = (currentPage - 1) * ITEMS_PER_PAGE;
	const end = start + ITEMS_PER_PAGE;
	const paginatedItems = items.slice(start, end);

	const displayablePages = Math.min(totalPages, MAX_VISIBLE_PAGES);
	let startPage = Math.max(
		1,
		currentPage - Math.floor(displayablePages / 2),
	);
	const endPage = Math.min(totalPages, startPage + displayablePages - 1);
	startPage = Math.max(1, endPage - displayablePages + 1);

	const visiblePages: number[] = [];
	for (let i = startPage; i <= endPage; i++) {
		visiblePages.push(i);
	}

	return {
		items: paginatedItems,
		currentPage,
		totalPages,
		visiblePages,
	};
}
