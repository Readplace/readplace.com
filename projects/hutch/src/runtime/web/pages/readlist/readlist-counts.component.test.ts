import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import type { ReadlistUrlState } from "./readlist.url";
import {
	renderReadlistCounts,
	showingLabel,
	toReadlistCountsDisplayModel,
} from "./readlist-counts.component";

const DEFAULT_FILTERS: ReadlistUrlState = { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 1 };

function parse(html: string): Document {
	return new JSDOM(html).window.document;
}

describe("showingLabel", () => {
	it("reports the page's row count alone when the total is unknown", () => {
		expect(showingLabel({ rowsOnPage: 20 })).toBe("Showing 20");
	});

	it("reports the page's row count against the total when known", () => {
		expect(showingLabel({ rowsOnPage: 20, total: 75 })).toBe("Showing 20 of 75");
	});
});

describe("numbered page links", () => {
	it("renders just the current page when the listing fits on one page", () => {
		const links = toReadlistCountsDisplayModel({ filters: { ...DEFAULT_FILTERS, page: 1 }, unreadCount: 0, tabTotal: 1, pageSize: 1 }).pages;

		expect(links.map((link) => link.label)).toEqual(["1"]);
		expect(links.map((link) => link.isCurrent)).toEqual([true]);
	});

	it("shows the run around page 1 with a gap before the last page across ten pages", () => {
		const links = toReadlistCountsDisplayModel({ filters: { ...DEFAULT_FILTERS, page: 1 }, unreadCount: 0, tabTotal: 10, pageSize: 1 }).pages;

		expect(links.map((link) => link.label)).toEqual(["1", "2", "…", "10"]);
		expect(links.find((link) => link.label === "1")?.isCurrent).toBe(true);
	});

	it("brackets the current page with a gap on each side when it sits in the middle", () => {
		const links = toReadlistCountsDisplayModel({ filters: { ...DEFAULT_FILTERS, page: 5 }, unreadCount: 0, tabTotal: 10, pageSize: 1 }).pages;

		expect(links.map((link) => link.label)).toEqual(["1", "…", "4", "5", "6", "…", "10"]);
		expect(links.find((link) => link.label === "5")?.isCurrent).toBe(true);
	});

	it("clamps a page beyond the last back onto the last page", () => {
		const links = toReadlistCountsDisplayModel({ filters: { ...DEFAULT_FILTERS, page: 99 }, unreadCount: 0, tabTotal: 10, pageSize: 1 }).pages;

		expect(links.filter((link) => link.isCurrent).map((link) => link.label)).toEqual(["10"]);
	});


	it("points every non-current page link at its own page, and gives the current page none", () => {
		const links = toReadlistCountsDisplayModel({ filters: { ...DEFAULT_FILTERS, page: 5 }, unreadCount: 0, tabTotal: 10, pageSize: 1 }).pages;

		const page6 = links.find((link) => link.label === "6");
		assert(page6, "page 6 must be reachable from page 5");
		const url = new URL(page6.href ?? "", "https://internal.invalid");
		expect(url.pathname).toBe("/queue");
		expect(url.searchParams.get("page")).toBe("6");

		const current = links.find((link) => link.isCurrent);
		assert(current, "the current page must be in the list");
		expect(current.href).toBeUndefined();
	});
});

describe("toReadlistCountsDisplayModel", () => {
	it("counts only the rows that actually landed on the last partial page", () => {
		const model = toReadlistCountsDisplayModel({
			filters: { ...DEFAULT_FILTERS, page: 4 },
			unreadCount: 0,
			tabTotal: 75,
			pageSize: 20,
		});

		expect(model.showingLabel).toBe("Showing 15 of 75");
	});

	it("reports zero rows for an empty readlist", () => {
		const model = toReadlistCountsDisplayModel({
			filters: DEFAULT_FILTERS,
			unreadCount: 0,
			tabTotal: 0,
			pageSize: 20,
		});

		expect(model.showingLabel).toBe("Showing 0 of 0");
	});
});

describe("renderReadlistCounts", () => {
	it("emits three out-of-band spans the mutation response can swap into the page", () => {
		const doc = parse(
			renderReadlistCounts(
				toReadlistCountsDisplayModel({
					filters: DEFAULT_FILTERS,
					unreadCount: 3,
					tabTotal: 45,
					pageSize: 20,
				}),
			),
		);

		for (const id of ["readlist-count", "readlist-pagination-info", "readlist-pages"]) {
			const el = doc.getElementById(id);
			assert(el, `the ${id} span must render`);
			expect(el.getAttribute("hx-swap-oob")).toBe("outerHTML");
		}
	});

	it("names the read total on the Read tab", () => {
		const doc = parse(
			renderReadlistCounts(
				toReadlistCountsDisplayModel({
					filters: { ...DEFAULT_FILTERS, tab: "done" },
					unreadCount: 3,
					tabTotal: 42,
					pageSize: 20,
				}),
			),
		);

		const number = doc.querySelector("[data-test-listing-count-number]");
		const noun = doc.querySelector("[data-test-listing-count-noun]");
		assert(number, "the count number span must render");
		assert(noun, "the count noun span must render");
		expect(number.textContent).toBe("42");
		expect(noun.textContent).toBe("Read Articles");
	});

	it("refreshes the unread tab label out of band, queue-scoped and capped at 99+", () => {
		const doc = parse(
			renderReadlistCounts(
				toReadlistCountsDisplayModel({
					filters: DEFAULT_FILTERS,
					unreadCount: 100,
					tabTotal: 100,
					pageSize: 20,
				}),
			),
		);

		const unread = doc.getElementById(`readlist-unread-label--${DEFAULT_READLIST_SLUG}`);
		assert(unread, "the unread tab label span must render");
		expect(unread.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(unread.textContent).toBe("To Read (99+)");
	});

	it("links every non-current page number", () => {
		const doc = parse(
			renderReadlistCounts(
				toReadlistCountsDisplayModel({
					filters: { ...DEFAULT_FILTERS, page: 1 },
					unreadCount: 0,
					tabTotal: 200,
					pageSize: 20,
				}),
			),
		);

		const link = doc.querySelector('[data-test-pagination-page="2"]');
		assert(link, "page 2 must be reachable from page 1");
		expect(link.tagName).toBe("A");
		const url = new URL(link.getAttribute("href") ?? "", "https://internal.invalid");
		expect(url.pathname).toBe("/queue");
		expect(url.searchParams.get("page")).toBe("2");
	});
});
