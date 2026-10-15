import { ReadingListItemIdSchema } from "../domain/reading-list-item-id";
import type { ReadingListItem } from "../domain/reading-list-item.types";
import { filterByQuery } from "./filter-by-query";

function item(fields: { url: string; title: string }): ReadingListItem {
	return {
		id: ReadingListItemIdSchema.parse(crypto.randomUUID()),
		url: fields.url,
		title: fields.title,
		savedAt: new Date(),
		actions: [],
		links: [],
		needsBrowserCapture: false,
	};
}

describe("filterByQuery", () => {
	const githubItem = item({ url: "https://github.com/example/repo", title: "A tour of the repo" });
	const mdnItem = item({ url: "https://developer.mozilla.org/en-US/docs", title: "Web docs" });
	const blogItem = item({ url: "https://blog.example.com/post", title: "Remote work culture" });
	const items = [githubItem, mdnItem, blogItem];

	it("returns every item when the query is empty", () => {
		expect(filterByQuery(items, "")).toEqual(items);
	});

	it("matches a word in the title", () => {
		expect(filterByQuery(items, "culture")).toEqual([blogItem]);
	});

	it("matches a path in the web address", () => {
		expect(filterByQuery(items, "en-US/docs")).toEqual([mdnItem]);
	});

	it("matches the source's host", () => {
		expect(filterByQuery(items, "github.com")).toEqual([githubItem]);
	});

	it("ignores case in the title and the web address", () => {
		expect(filterByQuery(items, "MOZILLA")).toEqual([mdnItem]);
		expect(filterByQuery(items, "REMOTE")).toEqual([blogItem]);
	});

	it("returns nothing when no title or web address matches", () => {
		expect(filterByQuery(items, "stackoverflow")).toEqual([]);
	});

	it("keeps every item whose title or web address shares the query", () => {
		expect(filterByQuery(items, "example")).toEqual([githubItem, blogItem]);
	});
});
