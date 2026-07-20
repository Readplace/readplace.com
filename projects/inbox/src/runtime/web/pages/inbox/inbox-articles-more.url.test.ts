import {
	ARTICLES_PAGE_SIZE,
	buildInboxArticlesMoreUrl,
	parseArticlesShown,
} from "./inbox-articles-more.url";

describe("buildInboxArticlesMoreUrl", () => {
	it("builds the delta path carrying the cumulative reveal count", () => {
		const url = buildInboxArticlesMoreUrl({
			emailId: "2026-06-24T09:00:00.000Z#<m@x>",
			shown: 40,
		});

		expect(url).toBe(
			"/inbox/2026-06-24T09%3A00%3A00.000Z%23%3Cm%40x%3E/articles/more?shown=40",
		);
	});
});

describe("parseArticlesShown", () => {
	it("defaults to the first page when the param is absent", () => {
		expect(parseArticlesShown({})).toBe(ARTICLES_PAGE_SIZE);
	});

	it("reads a cumulative reveal count past the first page", () => {
		expect(parseArticlesShown({ shown: "60" })).toBe(60);
	});

	it("floors a below-one-page count so the delta slice can never index before zero", () => {
		expect(parseArticlesShown({ shown: "5" })).toBe(ARTICLES_PAGE_SIZE);
	});

	it("falls back to the first page on a non-numeric count", () => {
		expect(parseArticlesShown({ shown: "banana" })).toBe(ARTICLES_PAGE_SIZE);
	});
});
