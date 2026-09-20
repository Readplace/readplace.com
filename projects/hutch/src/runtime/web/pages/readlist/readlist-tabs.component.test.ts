import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { READLIST_TABS } from "./readlist.tabs";
import {
	buildReadlistTabs,
	readlistTabLinkClass,
	renderReadlistTabs,
} from "./readlist-tabs.component";

const WORK: ReadlistSlug = ReadlistSlugSchema.parse("work");

function renderTabs(
	input: Omit<Parameters<typeof buildReadlistTabs>[0], "readlist" | "preferencesEnabled"> & {
		readlist?: ReadlistSlug;
		preferencesEnabled?: boolean;
	},
): Document {
	return new JSDOM(
		`<main>${renderReadlistTabs(
			buildReadlistTabs({
				readlist: DEFAULT_READLIST_SLUG,
				preferencesEnabled: false,
				...input,
			}),
		)}</main>`,
	).window.document;
}

function tabKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll("[data-test-filter]"), (tab) =>
		tab.getAttribute("data-test-filter"),
	);
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

describe("readlistTabLinkClass", () => {
	it("marks the tab being viewed", () => {
		expect(readlistTabLinkClass(true)).toBe(
			"readlist-tabs__link readlist-tabs__link--active",
		);
	});

	it("leaves every other tab unmarked", () => {
		expect(readlistTabLinkClass(false)).toBe("readlist-tabs__link");
	});
});

describe("buildReadlistTabs", () => {
	it("renders one link per registered tab, in registry order", () => {
		expect(tabKeys(renderTabs({ activeTab: "queue" }))).toEqual(
			READLIST_TABS.map((tab) => tab.testFilter),
		);
	});

	it("labels each tab from the registry", () => {
		const doc = renderTabs({ activeTab: "queue" });

		expect(tabLink(doc, "unread").textContent).toBe("To Read");
		expect(tabLink(doc, "read").textContent).toBe("Read");
	});

	it("marks only the tab being viewed as active", () => {
		const doc = renderTabs({ activeTab: "done" });

		const active = Array.from(doc.querySelectorAll(".readlist-tabs__link--active"), (tab) =>
			tab.getAttribute("data-test-filter"),
		);
		expect(active).toEqual(["read"]);
	});

	it("announces the tab being viewed as the current page", () => {
		const doc = renderTabs({ activeTab: "done" });

		expect(tabLink(doc, "read").getAttribute("aria-current")).toBe("page");
		expect(tabLink(doc, "unread").getAttribute("aria-current")).toBeNull();
	});

	it("points each tab at its own listing with its own tracking token", () => {
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

	it("carries the reader's sort order across a tab switch", () => {
		const doc = renderTabs({ activeTab: "queue", order: "asc" });

		expect(hrefParts(tabLink(doc, "unread")).params.get("order")).toBe("asc");
		expect(hrefParts(tabLink(doc, "read")).params.get("order")).toBe("asc");
	});

	it("keeps the preferences tab out of the strip until the feature is asked for", () => {
		expect(tabKeys(renderTabs({ activeTab: "queue", readlist: WORK }))).toEqual(["unread", "read"]);
	});

	it("offers the preferences tab on a reader-made readlist once the feature is asked for", () => {
		const doc = renderTabs({
			activeTab: "preferences",
			readlist: WORK,
			preferencesEnabled: true,
		});

		expect(tabKeys(doc)).toEqual(["unread", "read", "preferences"]);
		const preferences = tabLink(doc, "preferences");
		expect(preferences.getAttribute("aria-current")).toBe("page");
		expect(hrefParts(preferences).path).toBe("/queue/queues/work/preferences");
		expect(hrefParts(preferences).params.get("feature")).toBe("pref");
		expect(hrefParts(preferences).params.get("utm_content")).toBe("filter-preferences");
	});

	it("still hides the preferences tab on the built-in readlist with the feature on", () => {
		expect(tabKeys(renderTabs({ activeTab: "queue", preferencesEnabled: true }))).toEqual([
			"unread",
			"read",
		]);
	});

	it("carries the feature on the status tabs so the strip survives a hop between them", () => {
		const doc = renderTabs({ activeTab: "queue", readlist: WORK, preferencesEnabled: true });

		expect(hrefParts(tabLink(doc, "unread")).params.get("feature")).toBe("pref");
		expect(hrefParts(tabLink(doc, "read")).params.get("feature")).toBe("pref");
	});

	it("leaves the status tabs untouched while the feature is off", () => {
		const doc = renderTabs({ activeTab: "queue", readlist: WORK });

		expect(hrefParts(tabLink(doc, "unread")).params.get("feature")).toBe(null);
		expect(hrefParts(tabLink(doc, "read")).params.get("feature")).toBe(null);
	});

	it("gives only the counted tab a label the counts fragment can refresh", () => {
		const doc = renderTabs({ activeTab: "queue", readlist: WORK });

		const labelled = Array.from(doc.querySelectorAll("[data-test-filter] span[id]"), (label) => [
			label.closest("[data-test-filter]")?.getAttribute("data-test-filter"),
			label.getAttribute("id"),
		]);
		expect(labelled).toEqual([["unread", "readlist-unread-label--work"]]);

		const label = doc.querySelector("#readlist-unread-label--work");
		assert(label, "the unread tab must render the label the counts fragment refreshes");
		expect(label.hasAttribute("hx-preserve")).toBe(true);
		expect(label.textContent).toBe("To Read");
	});

	it("paints the count the render already knows into the counted tab", () => {
		expect(tabLink(renderTabs({ activeTab: "queue", knownUnreadCount: 0 }), "unread").textContent).toBe(
			"To Read (0)",
		);
		expect(tabLink(renderTabs({ activeTab: "queue", knownUnreadCount: 2 }), "unread").textContent).toBe(
			"To Read (2)",
		);
		expect(tabLink(renderTabs({ activeTab: "queue" }), "unread").textContent).toBe("To Read");
	});

	it("reserves the counted tab's widest label, on that tab only", () => {
		const doc = renderTabs({ activeTab: "queue" });

		const reserved = Array.from(doc.querySelectorAll("[data-widest]"), (label) => [
			label.closest("[data-test-filter]")?.getAttribute("data-test-filter"),
			label.getAttribute("data-widest"),
		]);
		expect(reserved).toEqual([["unread", "To Read (99+)"]]);
	});

	it("names the strip, the pressed tab and the listing as where a tab switch paints its in-flight state", () => {
		const nav = renderTabs({ activeTab: "queue" }).querySelector("nav[data-test-filters]");
		assert(nav, "the tab strip must be rendered");

		expect(nav.getAttribute("hx-boost")).toBe("true");
		expect(nav.getAttribute("hx-target")).toBe("main");
		expect(nav.getAttribute("hx-indicator")).toBe(
			"closest .readlist-tabs, closest .readlist-tabs__link, .readlist-listing",
		);
	});
});
