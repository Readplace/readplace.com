import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { READLIST_FILTER_SHOWN_ABOVE, renderReadlistFilter } from "./readlist-filter.component";

function filterOf(html: string): Element | null {
	return new JSDOM(`<ul>${html}</ul>`).window.document.querySelector("[data-test-readlist-filter]");
}

describe("renderReadlistFilter", () => {
	it("renders nothing while every readlist fits without one", () => {
		expect(renderReadlistFilter({ readlistCount: READLIST_FILTER_SHOWN_ABOVE, tag: "div" })).toBe("");
	});

	it("renders the filter hidden, for the page script to reveal, above the threshold", () => {
		const filter = filterOf(renderReadlistFilter({ readlistCount: READLIST_FILTER_SHOWN_ABOVE + 1, tag: "li", extraClass: "menu__filter" }));

		assert(filter, "the filter must be rendered");
		expect(filter.tagName).toBe("LI");
		expect(filter.hasAttribute("hidden")).toBe(true);
		expect(filter.classList.contains("menu__filter")).toBe(true);
		expect(filter.querySelector("[data-test-readlist-filter-input]")?.getAttribute("type")).toBe("search");
		expect(filter.querySelector("[data-test-readlist-filter-status]")?.getAttribute("aria-live")).toBe("polite");
	});

	it("renders the filter without an extra class when none is asked for", () => {
		const filter = filterOf(renderReadlistFilter({ readlistCount: READLIST_FILTER_SHOWN_ABOVE + 1, tag: "div" }));

		assert(filter, "the filter must be rendered");
		expect(filter.getAttribute("class")).toBe("readlist-filter");
	});
});
