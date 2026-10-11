import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderHiddenProgressBar, renderProgressBar } from "./progress-bar.component";

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

describe("renderProgressBar", () => {
	it.each(["reader", "summary"] as const)(
		"renders the %s axis as a labelled progressbar whose fill matches its label",
		(axis) => {
			const doc = parse(renderProgressBar({ axis, pct: 49, labelledBy: "panel-title" }));

			const bar = doc.querySelector(`[data-test-progress-bar="${axis}"]`);
			assert(bar, "the progress block must be rendered");
			expect(bar.classList.contains("article-body__progress--visible")).toBe(true);

			const label = bar.querySelector("[data-test-progress-label]");
			assert(label, "the label must be rendered");
			expect(label.textContent).toBe("49% complete");
			expect(label.getAttribute("aria-hidden")).toBe("true");

			const track = bar.querySelector(".article-body__progress-track");
			assert(track, "the track must be rendered");
			expect(track.getAttribute("role")).toBe("progressbar");
			expect(track.getAttribute("aria-labelledby")).toBe("panel-title");
			expect(track.getAttribute("aria-valuemin")).toBe("0");
			expect(track.getAttribute("aria-valuemax")).toBe("100");
			expect(track.getAttribute("aria-valuenow")).toBe("49");
			expect(track.getAttribute("aria-valuetext")).toBe("49% complete");

			const fill = track.querySelector<HTMLElement>(".article-body__progress-fill");
			assert(fill, "the fill must be rendered");
			expect(fill.style.width).toBe("49%");
		},
	);

	it("floors a fractional value in the label and the ARIA value but not in the fill width", () => {
		const doc = parse(renderProgressBar({ axis: "reader", pct: 46.5, labelledBy: "panel-title" }));

		const bar = doc.querySelector('[data-test-progress-bar="reader"]');
		assert(bar, "the progress block must be rendered");
		expect(bar.querySelector("[data-test-progress-label]")?.textContent).toBe("46% complete");
		const track = bar.querySelector(".article-body__progress-track");
		assert(track, "the track must be rendered");
		expect(track.getAttribute("aria-valuenow")).toBe("46");
		expect(track.getAttribute("aria-valuetext")).toBe("46% complete");
		const fill = track.querySelector<HTMLElement>(".article-body__progress-fill");
		assert(fill, "the fill must be rendered");
		expect(fill.style.width).toBe("46.5%");
	});
});

describe("renderHiddenProgressBar", () => {
	it.each(["reader", "summary"] as const)("renders an empty, hidden block for the %s axis", (axis) => {
		const doc = parse(renderHiddenProgressBar({ axis }));

		const bar = doc.querySelector(`[data-test-progress-bar="${axis}"]`);
		assert(bar, "the hidden progress block must be rendered");
		expect(bar.classList.contains("article-body__progress--hidden")).toBe(true);
		expect(bar.children.length).toBe(0);
	});
});
