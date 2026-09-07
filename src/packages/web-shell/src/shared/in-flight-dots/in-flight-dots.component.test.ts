import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderInFlightDots } from "./in-flight-dots.component";

function parseOnly(html: string): Element {
	const wrapper = new JSDOM(`<div>${html}</div>`).window.document.querySelector("div");
	assert(wrapper, "the fixture wrapper must parse");
	const dots = wrapper.firstElementChild;
	assert(dots, "the renderer must produce a single element");
	return dots;
}

describe("renderInFlightDots", () => {
	it("carries the caller's class, so each surface keeps its own gate selector", () => {
		expect(parseOnly(renderInFlightDots("toast__action-loader")).className).toBe(
			"toast__action-loader",
		);
		expect(
			parseOnly(renderInFlightDots("article-body__mark-read-loader in-flight-dots")).className,
		).toBe("article-body__mark-read-loader in-flight-dots");
	});

	it("hides itself from assistive tech, since the button's own label names the action", () => {
		expect(parseOnly(renderInFlightDots("toast__action-loader")).getAttribute("aria-label")).toBe(
			null,
		);
		expect(parseOnly(renderInFlightDots("toast__action-loader")).getAttribute("aria-hidden")).toBe(
			"true",
		);
	});

	it("renders three empty dots, so the button's textContent is unchanged", () => {
		const dots = parseOnly(renderInFlightDots("toast__action-loader"));
		expect(dots.textContent).toBe("");
		const spans = Array.from(dots.querySelectorAll("span"));
		expect(spans.length).toBe(3);
		expect(spans.map((span) => span.innerHTML)).toEqual(["", "", ""]);
	});
});
