import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderReadlistFilter } from "./readlist-filter.component";
import { initReadlistFilter } from "./readlist-filter.client";

const LABELS = ["Work", "Weekend reads", "Finance", "Recipes", "Travel", "Music", "Design", "Books", "Health", "Garden", "Workshop notes"];

function picker(): string {
	return `<details id="picker"><summary>Add</summary><ul data-readlist-filter-scope>${renderReadlistFilter({ readlistCount: LABELS.length, tag: "li" })}${LABELS.map((label) => `<li class="readlist-filter__option" data-test-option>${label}</li>`).join("")}</ul></details>`;
}

function attached(html: string = picker()): JSDOM {
	const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
	initReadlistFilter({ document: dom.window.document });
	return dom;
}

function typeInto(dom: JSDOM, value: string): void {
	const input = dom.window.document.querySelector<HTMLInputElement>("[data-test-readlist-filter-input]");
	assert(input, "the filter input must be rendered");
	input.value = value;
	input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function shownOptions(dom: JSDOM): string[] {
	return [...dom.window.document.querySelectorAll<HTMLElement>("[data-test-option]")].filter((option) => !option.hidden).map((option) => String(option.textContent));
}

function statusOf(dom: JSDOM): string {
	return String(dom.window.document.querySelector("[data-test-readlist-filter-status]")?.textContent);
}

function filterIsHidden(dom: JSDOM): boolean {
	const filter = dom.window.document.querySelector("[data-test-readlist-filter]");
	assert(filter, "the filter must be rendered");
	return filter.hasAttribute("hidden");
}

describe("initReadlistFilter", () => {
	it("reveals a filter already on the page", () => {
		expect(filterIsHidden(attached())).toBe(false);
	});

	it("reveals a filter swapped in later once htmx settles", () => {
		const dom = attached("<main></main>");
		const main = dom.window.document.querySelector("main");
		assert(main, "the fixture must have a main");
		main.innerHTML = picker();

		dom.window.document.dispatchEvent(new dom.window.Event("htmx:afterSettle"));

		expect(filterIsHidden(dom)).toBe(false);
	});

	it("reveals a filter inside a picker as it opens", () => {
		const dom = attached("<main></main>");
		const main = dom.window.document.querySelector("main");
		assert(main, "the fixture must have a main");
		main.innerHTML = picker();
		const details = dom.window.document.querySelector("#picker");
		assert(details, "the picker must be rendered");

		details.dispatchEvent(new dom.window.Event("toggle"));

		expect(filterIsHidden(dom)).toBe(false);
	});

	it("ignores a toggle that does not come from an element", () => {
		const dom = attached("<main></main>");

		dom.window.document.dispatchEvent(new dom.window.Event("toggle"));

		expect(dom.window.document.querySelector("main")?.innerHTML).toBe("");
	});

	it("keeps only the readlists whose name holds the typed text, ignoring case", () => {
		const dom = attached();

		typeInto(dom, "  WORK ");

		expect(shownOptions(dom)).toEqual(["Work", "Workshop notes"]);
		expect(statusOf(dom)).toBe("");
	});

	it("tells the reader when no readlist matches", () => {
		const dom = attached();

		typeInto(dom, "zzz");

		expect(shownOptions(dom)).toEqual([]);
		expect(statusOf(dom)).toBe("No readlists match");
	});

	it("brings every readlist back and clears the status once the text is cleared", () => {
		const dom = attached();
		typeInto(dom, "zzz");

		typeInto(dom, "");

		expect(shownOptions(dom)).toEqual(LABELS);
		expect(statusOf(dom)).toBe("");
	});

	it("leaves typing in any other field alone", () => {
		const dom = attached(`${picker()}<input id="other">`);
		const other = dom.window.document.querySelector<HTMLInputElement>("#other");
		assert(other, "the other field must be rendered");
		other.value = "zzz";

		other.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

		expect(shownOptions(dom)).toEqual(LABELS);
	});

	it("keeps Enter in the filter from submitting the form around it", () => {
		const dom = attached();
		const input = dom.window.document.querySelector("[data-test-readlist-filter-input]");
		assert(input, "the filter input must be rendered");
		const enter = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });

		input.dispatchEvent(enter);

		expect(enter.defaultPrevented).toBe(true);
	});

	it("leaves Enter elsewhere and other keys in the filter to the page", () => {
		const dom = attached(`${picker()}<input id="other">`);
		const input = dom.window.document.querySelector("[data-test-readlist-filter-input]");
		const other = dom.window.document.querySelector("#other");
		assert(input && other, "both fields must be rendered");
		const elsewhere = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
		const letter = new dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });

		other.dispatchEvent(elsewhere);
		input.dispatchEvent(letter);
		dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter" }));
		dom.window.document.dispatchEvent(new dom.window.Event("input"));

		expect(elsewhere.defaultPrevented).toBe(false);
		expect(letter.defaultPrevented).toBe(false);
	});
});
