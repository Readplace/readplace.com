import assert from "node:assert/strict";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema, type ReadlistSlug } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import { READLIST_TABS } from "./readlist.tabs";
import { buildReadlistTabs, renderReadlistTabs } from "./readlist-tabs.component";

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

function currentTabKeys(doc: Document): (string | null)[] {
	return Array.from(doc.querySelectorAll('[data-test-filter][aria-current="page"]'), (tab) =>
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

	it("marks only the tab being viewed as the current page", () => {
		expect(currentTabKeys(renderTabs({ activeTab: "queue" }))).toEqual(["unread"]);
		expect(currentTabKeys(renderTabs({ activeTab: "done" }))).toEqual(["read"]);
	});

	it("renders every tab as an underline tab", () => {
		const doc = renderTabs({ activeTab: "queue", readlist: WORK, preferencesEnabled: true });

		const classes = Array.from(doc.querySelectorAll("[data-test-filter]"), (tab) => [
			tab.getAttribute("data-test-filter"),
			tab.classList.contains("underline-tabs__tab"),
		]);
		expect(classes).toEqual([
			["unread", true],
			["read", true],
			["preferences", true],
		]);
	});

	it("gives every underline tab a reserved label", () => {
		const doc = renderTabs({ activeTab: "queue", readlist: WORK, preferencesEnabled: true });

		expect(doc.querySelectorAll(".underline-tabs__label[data-widest]")).toHaveLength(
			doc.querySelectorAll(".underline-tabs__tab").length,
		);
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

	it("carries the reader's search and filters across a tab switch", () => {
		const doc = renderTabs({
			activeTab: "queue",
			discovery: { q: "focus", time: ["5-10"], saved: ["month"], topic: ["others"] },
		});

		for (const testFilter of ["unread", "read"]) {
			const { params } = hrefParts(tabLink(doc, testFilter));
			expect([params.get("q"), params.getAll("time"), params.getAll("saved"), params.getAll("topic")]).toEqual([
				"focus",
				["5-10"],
				["month"],
				["others"],
			]);
		}
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
		expect(currentTabKeys(doc)).toEqual(["preferences"]);
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

	it("reserves every tab's widest label, so the pressed tab's weight change never moves the row", () => {
		const doc = renderTabs({ activeTab: "queue", readlist: WORK, preferencesEnabled: true });

		const reserved = Array.from(doc.querySelectorAll("[data-widest]"), (label) => [
			label.closest("[data-test-filter]")?.getAttribute("data-test-filter"),
			label.getAttribute("data-widest"),
		]);
		expect(reserved).toEqual([
			["unread", "To Read"],
			["read", "Read"],
			["preferences", "Preferences"],
		]);
	});

	it("names the strip, the pressed tab and the listing as where a tab switch paints its in-flight state", () => {
		const nav = renderTabs({ activeTab: "queue" }).querySelector("nav[data-test-filters]");
		assert(nav, "the tab strip must be rendered");

		expect(nav.getAttribute("hx-boost")).toBe("true");
		expect(nav.getAttribute("hx-target")).toBe("main");
		expect(nav.getAttribute("hx-indicator")).toBe(
			"closest .underline-tabs, closest .underline-tabs__tab, .readlist-listing",
		);
	});
});
