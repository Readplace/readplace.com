import { DEFAULT_QUEUE_SLUG } from "@packages/domain/queue";
import assert from "node:assert/strict";
import { generateCspNonce } from "@packages/web-shell";
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
		filters: { queue: DEFAULT_QUEUE_SLUG, tab: "queue", page: 1, ...input.filters },
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

function unreadLabel(doc: Document): Element {
	const label = doc.querySelector("#queue-unread-label");
	assert(label, "the counts fragment must carry the unread tab's label");
	return label;
}

describe("toQueueCountsDisplayModel", () => {
	it("should name the label the queue page reserved for the count", () => {
		expect(displayModelFor({}).unreadLabelId).toBe("queue-unread-label");
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
	it("should refresh the unread tab's label out of band", () => {
		const doc = parseFragment(renderQueueCounts(displayModelFor({ unreadCount: 7 })));
		const label = unreadLabel(doc);

		expect(label.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(label.hasAttribute("hx-preserve")).toBe(false);
		expect(label.textContent).toBe("To Read (7)");
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

	it("should swap only the unread label when the page it targets is not rendered", () => {
		const doc = parseFragment(renderQueueCounts(displayModelFor({ unreadCount: 5, tabTotal: 5 })));

		expect(swappedTargets(doc)).toEqual(["queue-unread-label"]);
		expect(unreadLabel(doc).textContent).toBe("To Read (5)");
	});
});

describe("queue counts fragment against the initial render", () => {
	function initialUnreadLabel(filters: QueueUrlState): Element {
		const vm = toQueueViewModel(
			{ articles: [], hasMore: false, page: filters.page, pageSize: PAGE_SIZE },
			filters,
			{ now: new Date("2026-01-01T00:00:00.000Z") },
		);
		const doc = parseFragment(QueuePage(vm, { cspNonce: generateCspNonce(), deviceClass: "desktop", queueHoldsArticles: false, saveTip: { state: "due", html: "" } }).content.html);
		const label = doc.querySelector("#queue-unread-label");
		assert(label, "the queue page must render the label the counts fragment refreshes");
		return label;
	}

	function swappedUnreadLabel(filters: QueueUrlState, unreadCount: number): Element {
		const doc = parseFragment(
			renderQueueCounts(
				toQueueCountsDisplayModel({ filters, unreadCount, tabTotal: 0, pageSize: PAGE_SIZE }),
			),
		);
		const label = doc.querySelector("#queue-unread-label");
		assert(label, "the counts fragment must render the unread tab's label");
		return label;
	}

	it.each<QueueUrlState>([
		{ queue: DEFAULT_QUEUE_SLUG, tab: "queue", page: 1 },
		{ queue: DEFAULT_QUEUE_SLUG, tab: "done", page: 1 },
		{ queue: DEFAULT_QUEUE_SLUG, tab: "queue", order: "asc", page: 2 },
		{ queue: DEFAULT_QUEUE_SLUG, tab: "done", order: "asc", page: 3 },
	])("should refresh the label the render preserves, for %o", (filters) => {
		expect(initialUnreadLabel(filters).hasAttribute("hx-preserve")).toBe(true);

		const swapped = swappedUnreadLabel(filters, 3);
		expect(swapped.getAttribute("hx-swap-oob")).toBe("innerHTML");
		expect(swapped.hasAttribute("hx-preserve")).toBe(false);
	});

	it("should replace the countless initial label with the counted one", () => {
		const filters: QueueUrlState = { queue: DEFAULT_QUEUE_SLUG, tab: "queue", page: 1 };

		expect(initialUnreadLabel(filters).textContent).toBe("To Read");
		expect(swappedUnreadLabel(filters, 3).textContent).toBe("To Read (3)");
	});
});
