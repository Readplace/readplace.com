import assert from "node:assert/strict";
import { toArticleTopics } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, ReadlistSlugSchema } from "@packages/domain/readlist";
import { JSDOM } from "jsdom";
import {
	buildReadlistDiscovery,
	renderReadlistDiscovery,
	renderReadlistFiltersDrawer,
} from "./readlist-discovery.component";
import type { ReadlistUrlState } from "./readlist.url";

const WORK = ReadlistSlugSchema.parse("work");

const UNFILTERED: ReadlistUrlState = { readlist: DEFAULT_READLIST_SLUG, tab: "queue", page: 1 };

function discoveryDoc(input: Partial<Parameters<typeof buildReadlistDiscovery>[0]> = {}): Document {
	const model = buildReadlistDiscovery({
		filters: UNFILTERED,
		tabHoldsRows: true,
		pageTopics: [],
		discoveryTopics: undefined,
		preferencesEnabled: false,
		...input,
	});
	return new JSDOM(`<main>${renderReadlistDiscovery(model)}${renderReadlistFiltersDrawer(model)}</main>`).window
		.document;
}

function element(doc: Document, selector: string): Element {
	const found = doc.querySelector(selector);
	assert(found, `${selector} must be rendered`);
	return found;
}

function hiddenFields(form: Element): [string | null, string | null][] {
	return Array.from(form.querySelectorAll(':scope > input[type="hidden"]'), (input) => [
		input.getAttribute("name"),
		input.getAttribute("value"),
	]);
}

function options(doc: Document, scope: string, group: string): (string | null)[] {
	return Array.from(
		doc.querySelectorAll(`[data-test-discovery-form="${scope}"] [data-test-discovery-option^="${group}:"]`),
		(option) => option.getAttribute("data-test-discovery-option"),
	);
}

function checkedOptions(doc: Document, scope: string): (string | null)[] {
	return Array.from(
		doc.querySelectorAll(`[data-test-discovery-form="${scope}"] [data-test-discovery-option]`),
		(option) => option,
	)
		.filter((option) => option.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked)
		.map((option) => option.getAttribute("data-test-discovery-option"));
}

function hrefParts(href: string | null): [string, [string, string][]] {
	const url = new URL(href ?? "", "https://internal.invalid");
	return [url.pathname, [...url.searchParams]];
}

describe("buildReadlistDiscovery", () => {
	it("shows the search row on a tab that holds rows", () => {
		const row = element(discoveryDoc({ tabHoldsRows: true }), "[data-test-discovery]");

		expect(row.classList.contains("readlist-discovery--visible")).toBe(true);
	});

	it("hides the search row on a tab that holds nothing", () => {
		const row = element(discoveryDoc({ tabHoldsRows: false }), "[data-test-discovery]");

		expect(row.classList.contains("readlist-discovery--hidden")).toBe(true);
	});

	it("searches through a boosted GET form named as a search landmark that veils only the listing", () => {
		const form = element(discoveryDoc(), '[data-test-form="readlist-search"]');

		expect([
			form.getAttribute("method"),
			form.getAttribute("action"),
			form.getAttribute("role"),
			form.getAttribute("hx-boost"),
			form.getAttribute("hx-target"),
			form.getAttribute("hx-select"),
			form.getAttribute("hx-swap"),
			form.getAttribute("hx-indicator"),
		]).toEqual(["GET", "/queue", "search", "true", "main", "main", "outerHTML show:none", ".readlist-listing"]);
	});

	it("names the search field with a hidden label and shows the query being searched", () => {
		const doc = discoveryDoc({
			filters: { ...UNFILTERED, discovery: { q: "São Paulo", time: [], saved: [], topic: [] } },
		});

		const input = element(doc, "[data-test-discovery-search]");
		expect([
			input.getAttribute("id"),
			input.getAttribute("type"),
			input.getAttribute("name"),
			input.getAttribute("value"),
			input.getAttribute("placeholder"),
			input.getAttribute("enterkeyhint"),
			input.getAttribute("autocomplete"),
		]).toEqual(["readlist-search-input", "search", "q", "São Paulo", "Search articles, topics, or sources…", "search", "off"]);
		const label = element(doc, 'label[for="readlist-search-input"]');
		expect(label.textContent).toBe("Search articles");
		expect(label.classList.contains("sr-only")).toBe(true);
	});

	it("carries the rest of the page state into a search, starting again at the first page", () => {
		const doc = discoveryDoc({
			filters: {
				readlist: WORK,
				tab: "done",
				order: "asc",
				page: 3,
				discovery: { q: "focus", time: ["5-10", "10-20"], saved: ["month"], topic: ["others"] },
			},
			preferencesEnabled: true,
		});

		expect(hiddenFields(element(doc, '[data-test-form="readlist-search"]'))).toEqual([
			["queue", "work"],
			["tab", "done"],
			["order", "asc"],
			["time", "5-10"],
			["time", "10-20"],
			["saved", "month"],
			["topic", "others"],
			["feature", "pref"],
			["utm_source", "queue-search"],
			["utm_medium", "internal"],
			["utm_content", "search"],
		]);
	});

	it("needs only the tracking fields to search the default listing", () => {
		expect(hiddenFields(element(discoveryDoc(), '[data-test-form="readlist-search"]'))).toEqual([
			["utm_source", "queue-search"],
			["utm_medium", "internal"],
			["utm_content", "search"],
		]);
	});

	it("names the filter button plainly while nothing is ticked", () => {
		const doc = discoveryDoc();

		const trigger = element(doc, '[data-test-action="open-discovery-filters"]');
		expect(trigger.textContent).toBe("Filters");
		expect(trigger.classList.contains("readlist-discovery__filter--idle")).toBe(true);
		const summary = element(doc, "[data-test-discovery-fallback] > summary");
		expect(summary.textContent).toBe("Filters");
		expect(summary.classList.contains("readlist-discovery__filter--idle")).toBe(true);
	});

	it("counts the ticked options into the filter button's name and marks it active", () => {
		const doc = discoveryDoc({
			filters: { ...UNFILTERED, discovery: { q: "focus", time: ["5-10"], saved: ["month"], topic: ["others"] } },
		});

		const trigger = element(doc, '[data-test-action="open-discovery-filters"]');
		expect(trigger.textContent).toBe("Filters (3)");
		expect(trigger.classList.contains("readlist-discovery__filter--active")).toBe(true);
		const summary = element(doc, "[data-test-discovery-fallback] > summary");
		expect(summary.textContent).toBe("Filters (3)");
		expect(summary.classList.contains("readlist-discovery__filter--active")).toBe(true);
	});

	it("opens the drawer as a dialog popover from the filter button", () => {
		const doc = discoveryDoc();

		const trigger = element(doc, '[data-test-action="open-discovery-filters"]');
		expect([trigger.getAttribute("type"), trigger.getAttribute("popovertarget"), trigger.getAttribute("aria-haspopup")]).toEqual([
			"button",
			"readlist-filters",
			"dialog",
		]);
		const drawer = element(doc, "[data-test-discovery-drawer]");
		expect([
			drawer.getAttribute("id"),
			drawer.getAttribute("popover"),
			drawer.getAttribute("role"),
			drawer.getAttribute("tabindex"),
			drawer.hasAttribute("autofocus"),
			drawer.getAttribute("aria-labelledby"),
		]).toEqual(["readlist-filters", "auto", "dialog", "-1", true, "readlist-filters-title"]);
		expect(element(doc, "#readlist-filters-title").textContent).toBe("Filters");
	});

	it("groups the options under reading time, saved date and category", () => {
		const legends = Array.from(
			discoveryDoc().querySelectorAll('[data-test-discovery-form="popover"] .readlist-filters__legend'),
			(legend) => legend.textContent,
		);

		expect(legends).toEqual(["Reading time", "Saved date", "Category"]);
	});

	it("offers every reading-time bucket and saved-date window by its label", () => {
		const doc = discoveryDoc();

		expect(options(doc, "popover", "time")).toEqual(["time:under-5", "time:5-10", "time:10-20", "time:20-plus"]);
		expect(options(doc, "popover", "saved")).toEqual(["saved:today", "saved:week", "saved:month", "saved:older"]);
		const labels = Array.from(
			doc.querySelectorAll('[data-test-discovery-form="popover"] .chip--filter'),
			(chip) => chip.textContent,
		);
		expect(labels).toEqual([
			"Under 5 min",
			"5–10 min",
			"10–20 min",
			"20+ min",
			"Today",
			"This week",
			"This month",
			"Older",
			"Others",
		]);
	});

	it("draws each option as a checkbox behind a filter chip", () => {
		const option = element(discoveryDoc(), '[data-test-discovery-form="popover"] [data-test-discovery-option="time:5-10"]');

		const input = option.querySelector('input[type="checkbox"]');
		assert(input, "each option must hold its checkbox");
		expect([input.getAttribute("name"), input.getAttribute("value"), input.className]).toEqual([
			"time",
			"5-10",
			"chip__input sr-only",
		]);
		expect(input.nextElementSibling?.className).toBe("chip chip--filter");
	});

	it("offers the page's topics, most frequent first, while nothing narrows the list", () => {
		const doc = discoveryDoc({
			pageTopics: [toArticleTopics(["Trends", "Focus"]), toArticleTopics(["Focus"]), toArticleTopics(["Lifestyle"])],
		});

		expect(options(doc, "popover", "topic")).toEqual([
			"topic:Focus",
			"topic:Lifestyle",
			"topic:Trends",
			"topic:others",
		]);
	});

	it("offers the store's topics once a search or filter is active, keeping a ticked topic it no longer reports", () => {
		const doc = discoveryDoc({
			filters: {
				...UNFILTERED,
				discovery: { time: [], saved: [], topic: [...toArticleTopics(["Fintech"]), ...toArticleTopics(["focus"])] },
			},
			pageTopics: [toArticleTopics(["Lifestyle"])],
			discoveryTopics: toArticleTopics(["Focus", "Productivity"]),
		});

		expect(options(doc, "popover", "topic")).toEqual([
			"topic:Focus",
			"topic:Productivity",
			"topic:Fintech",
			"topic:others",
		]);
		expect(checkedOptions(doc, "popover")).toEqual(["topic:Focus", "topic:Fintech"]);
	});

	it("ticks exactly the options the URL names, in both copies of the drawer", () => {
		const doc = discoveryDoc({
			filters: { ...UNFILTERED, discovery: { time: ["5-10", "20-plus"], saved: ["older"], topic: ["others"] } },
		});

		const ticked = ["time:5-10", "time:20-plus", "saved:older", "topic:others"];
		expect(checkedOptions(doc, "popover")).toEqual(ticked);
		expect(checkedOptions(doc, "fallback")).toEqual(ticked);
	});

	it("carries the place and the search into Apply, in both copies of the drawer", () => {
		const doc = discoveryDoc({
			filters: {
				readlist: WORK,
				tab: "done",
				order: "asc",
				page: 2,
				discovery: { q: "focus", time: ["5-10"], saved: [], topic: [] },
			},
			preferencesEnabled: true,
		});

		const fields = [
			["queue", "work"],
			["tab", "done"],
			["order", "asc"],
			["q", "focus"],
			["feature", "pref"],
			["utm_source", "queue-filter-drawer"],
			["utm_medium", "internal"],
			["utm_content", "apply"],
		];
		expect(hiddenFields(element(doc, '[data-test-discovery-form="popover"]'))).toEqual(fields);
		expect(hiddenFields(element(doc, '[data-test-discovery-form="fallback"]'))).toEqual(fields);
	});

	it("clears the ticked options but keeps the search, the place and the preferences flag", () => {
		const doc = discoveryDoc({
			filters: {
				readlist: WORK,
				tab: "done",
				order: "asc",
				page: 2,
				discovery: { q: "focus", time: ["5-10"], saved: ["week"], topic: ["others"] },
			},
			preferencesEnabled: true,
		});

		for (const scope of ["popover", "fallback"]) {
			const clearAll = element(doc, `[data-test-discovery-form="${scope}"] [data-test-action="clear-discovery-filters"]`);
			expect(hrefParts(clearAll.getAttribute("href"))).toEqual([
				"/queue",
				[
					["queue", "work"],
					["tab", "done"],
					["order", "asc"],
					["q", "focus"],
					["feature", "pref"],
					["utm_source", "queue-filter-drawer"],
					["utm_medium", "internal"],
					["utm_content", "clear-all"],
				],
			]);
		}
	});

	it("offers Close only inside the popover copy, which hides that popover", () => {
		const doc = discoveryDoc();

		const closes = Array.from(doc.querySelectorAll('[data-test-action="close-discovery-filters"]'), (close) => [
			close.closest("[data-test-discovery-form]")?.getAttribute("data-test-discovery-form"),
			close.getAttribute("popovertarget"),
			close.getAttribute("popovertargetaction"),
			close.textContent,
		]);
		expect(closes).toEqual([["popover", "readlist-filters", "hide", "Close"]]);
	});

	it("submits both copies of the drawer as boosted GET forms that paint their own in-flight state", () => {
		const doc = discoveryDoc();

		const forms = Array.from(doc.querySelectorAll('[data-test-form="readlist-filters"]'), (form) => [
			form.getAttribute("data-test-discovery-form"),
			form.getAttribute("method"),
			form.getAttribute("action"),
			form.getAttribute("hx-boost"),
			form.getAttribute("hx-swap"),
			form.getAttribute("hx-indicator"),
			form.getAttribute("hx-disabled-elt"),
		]);
		expect(forms).toEqual([
			["fallback", "GET", "/queue", "true", "outerHTML show:none", "closest form, .readlist-listing", "find button[type=submit]"],
			["popover", "GET", "/queue", "true", "outerHTML show:none", "closest form, .readlist-listing", "find button[type=submit]"],
		]);
	});

	it("keeps each drawer form's Apply-disabling selector off its boosted Clear all link, which holds no button to find", () => {
		const doc = discoveryDoc();

		const forms = Array.from(doc.querySelectorAll('[data-test-form="readlist-filters"]'), (form) => [
			form.getAttribute("data-test-discovery-form"),
			form.getAttribute("hx-disinherit"),
			form.querySelector('[data-test-action="clear-discovery-filters"]')?.tagName,
		]);
		expect(forms).toEqual([
			["fallback", "hx-disabled-elt", "A"],
			["popover", "hx-disabled-elt", "A"],
		]);
	});

	it("holds the Apply label's width while the in-flight dots replace it", () => {
		const apply = element(discoveryDoc(), '[data-test-discovery-form="popover"] [data-test-action="apply-discovery-filters"]');

		expect(apply.getAttribute("type")).toBe("submit");
		expect(Array.from(apply.children, (child) => child.className)).toEqual([
			"readlist-filters__apply-label",
			"readlist-filters__apply-loader in-flight-dots",
		]);
		expect(apply.querySelector(".readlist-filters__apply-label")?.textContent).toBe("Apply filters");
	});

	it("labels each copy's title by its own id", () => {
		const doc = discoveryDoc();

		const titles = Array.from(doc.querySelectorAll(".readlist-filters__title"), (title) => [
			title.closest("[data-test-discovery-form]")?.getAttribute("data-test-discovery-form"),
			title.getAttribute("id"),
		]);
		expect(titles).toEqual([
			["fallback", "readlist-filters-fallback-title"],
			["popover", "readlist-filters-title"],
		]);
	});
});
