import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import {
	buildReadlistFilters,
	filterLinkClass,
	formatUnreadLabel,
	renderReadlistFilters,
} from "./readlist-filters.component";
import { READLIST_TABS } from "./readlist.tabs";

function renderTabs(
	input: Omit<Parameters<typeof buildReadlistFilters>[0], "readlist"> & { readlist?: ReadlistSlug },
): Document {
	return new JSDOM(
		`<main>${renderReadlistFilters(buildReadlistFilters({ readlist: DEFAULT_READLIST_SLUG, ...input }))}</main>`,
	).window.document;
}

function tabLink(doc: Document, testFilter: string): Element {
	const link = doc.querySelector(`[data-test-filter="${testFilter}"]`);
	assert(link, `the ${testFilter} tab must be rendered`);
	return link;
}

function hrefParts(link: Element): { path: string; params: URLSearchParams } {
	const url = new URL(link.getAttribute("href") ?? "", "https://internal.invalid");
	return { path: url.pathname, params: url.searchParams };
}

describe("formatUnreadLabel", () => {
	it("should format zero count", () => {
		expect(formatUnreadLabel(0)).toBe("To Read (0)");
	});

	it("should format normal count", () => {
		expect(formatUnreadLabel(5)).toBe("To Read (5)");
	});

	it("should format count at boundary", () => {
		expect(formatUnreadLabel(99)).toBe("To Read (99)");
	});

	it("should cap at 99+ when count exceeds 99", () => {
		expect(formatUnreadLabel(100)).toBe("To Read (99+)");
	});
});

describe("filterLinkClass", () => {
	it("should mark the active filter", () => {
		expect(filterLinkClass(true)).toBe("readlist__filter-link readlist__filter-link--active");
	});

	it("should leave an inactive filter unmarked", () => {
		expect(filterLinkClass(false)).toBe("readlist__filter-link");
	});
});

describe("buildReadlistFilters", () => {
	it("should render one link per registered tab, in registry order", () => {
		const doc = renderTabs({ activeTab: "queue" });

		const rendered = Array.from(doc.querySelectorAll("[data-test-filter]")).map((el) =>
			el.getAttribute("data-test-filter"),
		);
		expect(rendered).toEqual(READLIST_TABS.map((tab) => tab.testFilter));
	});

	it("should label each tab from the registry", () => {
		const doc = renderTabs({ activeTab: "queue" });

		expect(tabLink(doc, "unread").textContent).toBe("To Read");
		expect(tabLink(doc, "read").textContent).toBe("Read");
	});

	it("should mark only the tab being viewed as active", () => {
		const doc = renderTabs({ activeTab: "done" });

		const active = Array.from(doc.querySelectorAll(".readlist__filter-link--active")).map((el) =>
			el.getAttribute("data-test-filter"),
		);
		expect(active).toEqual(["read"]);
	});

	it("should announce the tab being viewed as the current page", () => {
		const doc = renderTabs({ activeTab: "done" });

		expect(tabLink(doc, "read").getAttribute("aria-current")).toBe("page");
		expect(tabLink(doc, "unread").getAttribute("aria-current")).toBeNull();
	});

	it("should point each tab at its own listing with its own tracking token", () => {
		const doc = renderTabs({ activeTab: "queue" });

		const unread = hrefParts(tabLink(doc, "unread"));
		expect(unread.path).toBe("/queue");
		expect(unread.params.get("tab")).toBeNull();
		expect(unread.params.get("utm_content")).toBe("filter-unread");

		const read = hrefParts(tabLink(doc, "read"));
		expect(read.path).toBe("/queue");
		expect(read.params.get("tab")).toBe("done");
		expect(read.params.get("utm_content")).toBe("filter-read");
	});

	it("should carry the reader's sort order across a tab switch", () => {
		const doc = renderTabs({ activeTab: "queue", order: "asc" });

		expect(hrefParts(tabLink(doc, "unread")).params.get("order")).toBe("asc");
		expect(hrefParts(tabLink(doc, "read")).params.get("order")).toBe("asc");
	});

	it("should give only the counted tab a label the counts fragment can refresh", () => {
		const doc = renderTabs({ activeTab: "queue" });

		const labelled = Array.from(doc.querySelectorAll("[data-test-filter] span[id]")).map((el) => [
			el.closest("[data-test-filter]")?.getAttribute("data-test-filter"),
			el.getAttribute("id"),
		]);
		expect(labelled).toEqual([["unread", "readlist-unread-label--default"]]);
	});

	it("should scope the counted tab's label id to the queue being viewed", () => {
		const doc = renderTabs({ activeTab: "queue", readlist: ReadlistSlugSchema.parse("work") });

		const labelled = Array.from(doc.querySelectorAll("[data-test-filter] span[id]")).map((el) => [
			el.closest("[data-test-filter]")?.getAttribute("data-test-filter"),
			el.getAttribute("id"),
		]);
		expect(labelled).toEqual([["unread", "readlist-unread-label--work"]]);

		const label = doc.querySelector("#readlist-unread-label--work");
		assert(label, "the unread tab must render the label the counts fragment refreshes");
		expect(label.hasAttribute("hx-preserve")).toBe(true);
		expect(label.textContent).toBe("To Read");
	});

	it("should paint the count the render already knows into the counted tab", () => {
		expect(tabLink(renderTabs({ activeTab: "queue", knownUnreadCount: 0 }), "unread").textContent).toBe(
			"To Read (0)",
		);
		expect(tabLink(renderTabs({ activeTab: "queue", knownUnreadCount: 2 }), "unread").textContent).toBe(
			"To Read (2)",
		);
		expect(tabLink(renderTabs({ activeTab: "queue" }), "unread").textContent).toBe("To Read");
	});

	it("should reserve the counted tab's widest label, on that tab only", () => {
		const doc = renderTabs({ activeTab: "queue" });

		const reserved = Array.from(doc.querySelectorAll("[data-widest]")).map((el) => [
			el.closest("[data-test-filter]")?.getAttribute("data-test-filter"),
			el.getAttribute("data-widest"),
		]);
		expect(reserved).toEqual([["unread", "To Read (99+)"]]);
	});

	it("should mark the counted tab's label preserved so a boosted swap keeps the count", () => {
		const doc = renderTabs({ activeTab: "queue" });
		const label = doc.querySelector('[data-test-filter="unread"] span[id]');
		assert(label, "the unread tab must render the label the counts fragment refreshes");

		expect(label.hasAttribute("hx-preserve")).toBe(true);
		expect(label.textContent).toBe("To Read");
	});

	it("should name the strip, the pressed tab and the listing as where a tab switch paints its in-flight state", () => {
		const nav = renderTabs({ activeTab: "queue" }).querySelector("nav[data-test-filters]");
		assert(nav, "the filters nav must be rendered");

		expect(nav.getAttribute("hx-boost")).toBe("true");
		expect(nav.getAttribute("hx-target")).toBe("main");
		expect(nav.getAttribute("hx-indicator")).toBe(
			"closest .readlist__filters, closest .readlist__filter-link, .readlist__listing",
		);
	});
});
