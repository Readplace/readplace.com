import type {
	ReadingListItem,
	ReadingListItemId,
} from "../domain/reading-list-item.types";
import { filterByUrl } from "./filter-by-url";

function item(url: string): ReadingListItem {
	return {
		id: crypto.randomUUID() as ReadingListItemId,
		url,
		title: url,
		savedAt: new Date(),
		actions: [],
		links: [],
	};
}

describe("filterByUrl", () => {
	const githubItem = item("https://github.com/example/repo");
	const mdnItem = item("https://developer.mozilla.org/en-US/docs");
	const blogItem = item("https://blog.example.com/post");
	const items = [githubItem, mdnItem, blogItem];

	it("should return all items when query is empty", () => {
		const result = filterByUrl(items, "");

		expect(result).toEqual(items);
	});

	it("should filter items by URL substring match", () => {
		const result = filterByUrl(items, "github");

		expect(result).toEqual([githubItem]);
	});

	it("should be case-insensitive", () => {
		const result = filterByUrl(items, "MOZILLA");

		expect(result).toEqual([mdnItem]);
	});

	it("should return empty array when no items match", () => {
		const result = filterByUrl(items, "stackoverflow");

		expect(result).toEqual([]);
	});

	it("should match multiple items with shared URL substring", () => {
		const result = filterByUrl(items, "example");

		expect(result).toEqual([githubItem, blogItem]);
	});
});
