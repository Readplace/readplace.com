import type { ReadingListItem } from "../domain/reading-list-item.types";

export function filterByUrl(
	items: ReadingListItem[],
	query: string,
): ReadingListItem[] {
	if (!query) return items;
	return items.filter((item) =>
		item.url.toLowerCase().includes(query.toLowerCase()),
	);
}
