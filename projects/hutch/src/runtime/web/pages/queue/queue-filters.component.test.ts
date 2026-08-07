import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	buildQueueFilters,
	filterLinkClass,
	formatUnreadLabel,
	renderQueueFilters,
} from "./queue-filters.component";
import { QUEUE_TABS } from "./queue.tabs";

function renderTabs(input: Parameters<typeof buildQueueFilters>[0]): Document {
	return new JSDOM(`<main>${renderQueueFilters(buildQueueFilters(input))}</main>`).window.document;
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
		expect(filterLinkClass(true)).toBe("queue__filter-link queue__filter-link--active");
	});

	it("should leave an inactive filter unmarked", () => {
		expect(filterLinkClass(false)).toBe("queue__filter-link");
	});
});

describe("buildQueueFilters", () => {
	it("should render one link per registered tab, in registry order", () => {
		const doc = renderTabs({ activeTab: "queue" });

		const rendered = Array.from(doc.querySelectorAll("[data-test-filter]")).map((el) =>
			el.getAttribute("data-test-filter"),
		);
		expect(rendered).toEqual(QUEUE_TABS.map((tab) => tab.testFilter));
	});

	it("should label each tab from the registry", () => {
		const doc = renderTabs({ activeTab: "queue" });

		expect(tabLink(doc, "unread").textContent).toBe("To Read");
		expect(tabLink(doc, "read").textContent).toBe("Read");
	});

	it("should mark only the tab being viewed as active", () => {
		const doc = renderTabs({ activeTab: "done" });

		const active = Array.from(doc.querySelectorAll(".queue__filter-link--active")).map((el) =>
			el.getAttribute("data-test-filter"),
		);
		expect(active).toEqual(["read"]);
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

	it("should anchor only the tab the counts fragment swaps out of band", () => {
		const doc = renderTabs({ activeTab: "queue" });

		const anchored = Array.from(doc.querySelectorAll("[data-test-filter][id]")).map((el) => [
			el.getAttribute("data-test-filter"),
			el.getAttribute("id"),
		]);
		expect(anchored).toEqual([["unread", "queue-filter-unread"]]);
	});
});
