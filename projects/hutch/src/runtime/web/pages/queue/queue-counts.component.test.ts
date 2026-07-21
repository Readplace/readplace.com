import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderQueueCounts, toQueueCountsDisplayModel } from "./queue-counts.component";
import { QueuePage } from "./queue.component";
import { toQueueViewModel } from "./queue.viewmodel";
import type { QueueUrlState } from "./queue.url";

const PAGE_SIZE = 20;

function displayModelFor(input: {
	filters?: Partial<QueueUrlState>;
	unreadCount?: number;
	tabTotal?: number;
}) {
	return toQueueCountsDisplayModel({
		filters: { tab: "queue", page: 1, ...input.filters },
		unreadCount: input.unreadCount ?? 0,
		tabTotal: input.tabTotal ?? 0,
		pageSize: PAGE_SIZE,
	});
}

function parseFragment(html: string): Document {
	return new JSDOM(`<main>${html}</main>`).window.document;
}

function swappedTargets(doc: Document): string[] {
	return Array.from(doc.querySelectorAll("[hx-swap-oob]"), (element) => element.id);
}

function unreadTab(doc: Document): Element {
	const tab = doc.querySelector("#queue-filter-unread");
	assert(tab, "the counts fragment must carry the unread tab");
	return tab;
}

describe("toQueueCountsDisplayModel", () => {
	it("should mark the unread filter active on the To Read tab", () => {
		expect(displayModelFor({ filters: { tab: "queue" } }).filterUnreadClass).toBe(
			"queue__filter-link queue__filter-link--active",
		);
	});

	it("should mark the unread filter inactive on the Read tab", () => {
		expect(displayModelFor({ filters: { tab: "done" } }).filterUnreadClass).toBe(
			"queue__filter-link",
		);
	});

	it("should point the unread filter at the To Read tab from either tab", () => {
		const fromDone = displayModelFor({ filters: { tab: "done" } });

		expect(fromDone.filterUnreadUrl).toBe(
			"/queue?utm_source=queue-filters&utm_medium=internal&utm_content=filter-unread",
		);
	});

	it("should carry a non-default sort order onto the unread filter URL", () => {
		const ascending = displayModelFor({ filters: { tab: "queue", order: "asc" } });

		expect(ascending.filterUnreadUrl).toBe(
			"/queue?order=asc&utm_source=queue-filters&utm_medium=internal&utm_content=filter-unread",
		);
	});

	it("should drop the page from the unread filter URL so the tab restarts at page 1", () => {
		expect(displayModelFor({ filters: { tab: "queue", page: 3 } }).filterUnreadUrl).toBe(
			"/queue?utm_source=queue-filters&utm_medium=internal&utm_content=filter-unread",
		);
	});

	it("should label the badge with the exact unread count below the cap", () => {
		expect(displayModelFor({ unreadCount: 42 }).filterUnreadLabel).toBe("To Read (42)");
	});

	it("should label the badge with the last exact count at the display boundary", () => {
		expect(displayModelFor({ unreadCount: 99 }).filterUnreadLabel).toBe("To Read (99)");
	});

	it("should label the badge 99+ once the capped count reaches the limit", () => {
		expect(displayModelFor({ unreadCount: 100 }).filterUnreadLabel).toBe("To Read (99+)");
	});

	it("should hide the page count when the tab fits on a single page", () => {
		const exactlyOnePage = displayModelFor({ tabTotal: PAGE_SIZE });

		expect(exactlyOnePage.totalPages).toBe(1);
		expect(exactlyOnePage.showPageCount).toBe(false);
	});

	it("should hide the page count for an empty tab", () => {
		const empty = displayModelFor({ tabTotal: 0 });

		expect(empty.totalPages).toBe(1);
		expect(empty.showPageCount).toBe(false);
	});

	it("should show the page count as soon as the tab spills past one page", () => {
		const spilled = displayModelFor({ tabTotal: PAGE_SIZE + 1 });

		expect(spilled.totalPages).toBe(2);
		expect(spilled.showPageCount).toBe(true);
	});

	it("should round a partial last page up", () => {
		expect(displayModelFor({ tabTotal: 75 }).totalPages).toBe(4);
	});

	it("should not invent a page for an exact multiple of the page size", () => {
		expect(displayModelFor({ tabTotal: 80 }).totalPages).toBe(4);
	});

	it("should report the page the reader is currently on", () => {
		expect(displayModelFor({ filters: { page: 3 }, tabTotal: 75 }).currentPage).toBe(3);
	});
});

describe("renderQueueCounts", () => {
	it("should swap the unread tab out of band", () => {
		const doc = parseFragment(renderQueueCounts(displayModelFor({ unreadCount: 7 })));
		const tab = doc.querySelector("#queue-filter-unread");

		assert(tab, "counts fragment must carry the unread tab");
		expect(tab.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(tab.getAttribute("data-test-filter")).toBe("unread");
		expect(tab.textContent).toBe("To Read (7)");
	});

	it("should swap the pagination info out of band when the tab spans pages", () => {
		const doc = parseFragment(
			renderQueueCounts(displayModelFor({ filters: { page: 2 }, tabTotal: 75 })),
		);
		const info = doc.querySelector("#queue-pagination-info");

		assert(info, "counts fragment must carry the pagination info when there is more than one page");
		expect(info.getAttribute("hx-swap-oob")).toBe("outerHTML");
		expect(info.getAttribute("class")).toBe("queue__pagination-info");
		expect(info.hasAttribute("data-test-pagination-info")).toBe(true);
		expect(info.textContent).toBe("Page 2 of 4");
	});

	it("should swap only the unread tab when the page it targets is not rendered", () => {
		const doc = parseFragment(renderQueueCounts(displayModelFor({ unreadCount: 5, tabTotal: 5 })));

		expect(swappedTargets(doc)).toEqual(["queue-filter-unread"]);
		expect(unreadTab(doc).textContent).toBe("To Read (5)");
	});
});

describe("queue counts fragment against the initial render", () => {
	function initialUnreadTab(filters: QueueUrlState): Element {
		const vm = toQueueViewModel(
			{ articles: [], hasMore: false, page: filters.page, pageSize: PAGE_SIZE },
			filters,
			{ now: new Date("2026-01-01T00:00:00.000Z") },
		);
		const doc = parseFragment(QueuePage(vm, { deviceClass: "desktop" }).content.html);
		const tab = doc.querySelector("#queue-filter-unread");
		assert(tab, "the queue page must render the unread tab the counts fragment targets");
		return tab;
	}

	function swappedUnreadTab(filters: QueueUrlState, unreadCount: number): Element {
		const doc = parseFragment(
			renderQueueCounts(
				toQueueCountsDisplayModel({ filters, unreadCount, tabTotal: 0, pageSize: PAGE_SIZE }),
			),
		);
		const tab = doc.querySelector("#queue-filter-unread");
		assert(tab, "the counts fragment must render the unread tab");
		return tab;
	}

	it.each<QueueUrlState>([
		{ tab: "queue", page: 1 },
		{ tab: "done", page: 1 },
		{ tab: "queue", order: "asc", page: 2 },
		{ tab: "done", order: "asc", page: 3 },
	])("should reuse the class and href the initial render produced for %o", (filters) => {
		const initial = initialUnreadTab(filters);
		const swapped = swappedUnreadTab(filters, 3);
		const href = initial.getAttribute("href");
		assert(href, "the initial unread tab must carry the href the swap has to preserve");

		expect(swapped.getAttribute("class")).toBe(initial.getAttribute("class"));
		expect(swapped.getAttribute("href")).toBe(href);
	});

	it("should replace the countless initial label with the counted one", () => {
		const filters: QueueUrlState = { tab: "queue", page: 1 };

		expect(initialUnreadTab(filters).textContent).toBe("To Read");
		expect(swappedUnreadTab(filters, 3).textContent).toBe("To Read (3)");
	});
});
