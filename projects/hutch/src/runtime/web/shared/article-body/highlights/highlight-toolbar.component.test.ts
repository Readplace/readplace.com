import { JSDOM } from "jsdom";
import { renderHighlightToolbar } from "./highlight-toolbar.component";

function toolbarDocument(): Document {
	return new JSDOM(renderHighlightToolbar({ createUrl: "/queue/abc/highlights?feature=highlight" })).window.document;
}

describe("renderHighlightToolbar", () => {
	it("renders a hidden toolbar holding one Highlight button", () => {
		const toolbar = toolbarDocument().querySelector("[data-test-highlight-toolbar]");

		expect(toolbar?.getAttribute("role")).toBe("toolbar");
		expect(toolbar?.getAttribute("aria-label")).toBe("Highlight selection");
		expect(toolbar?.hasAttribute("hidden")).toBe(true);
		expect(Array.from(toolbar?.querySelectorAll("button") ?? [], (button) => button.textContent)).toEqual(["Highlight"]);
	});

	it("posts the create form to the tracked, flagged url with the passage fields", () => {
		const form = toolbarDocument().querySelector("[data-test-highlight-create-form]");
		const url = new URL(form?.getAttribute("action") ?? "", "https://readplace.com");

		expect(url.pathname).toBe("/queue/abc/highlights");
		expect(url.searchParams.get("feature")).toBe("highlight");
		expect(url.searchParams.get("utm_source")).toBe("highlight-toolbar");
		expect(url.searchParams.get("utm_content")).toBe("highlight");
		expect(Array.from(form?.querySelectorAll("input") ?? [], (input) => input.name)).toEqual([
			"exact",
			"start",
			"end",
			"origin",
		]);
		expect(form?.getAttribute("hx-target")).toBe("main");
		expect(form?.getAttribute("hx-select")).toBe("main");
		expect(form?.getAttribute("hx-swap")).toBe("outerHTML show:none");
	});
});
