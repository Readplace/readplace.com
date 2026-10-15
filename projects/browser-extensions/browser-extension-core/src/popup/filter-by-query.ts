import type { ReadingListItem } from "../domain/reading-list-item.types";

export function filterByQuery(
	items: ReadingListItem[],
	query: string,
): ReadingListItem[] {
	if (!query) return items;
	const needle = query.toLowerCase();
	return items.filter(
		(item) =>
			item.title.toLowerCase().includes(needle) ||
			item.url.toLowerCase().includes(needle),
	);
}
