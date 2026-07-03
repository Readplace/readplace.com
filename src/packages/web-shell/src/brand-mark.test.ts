import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { brandMarkSvg } from "./brand-mark";

const FONT = "Georgia, 'Times New Roman', serif";

function parseMark(svg: string): Document {
	return new JSDOM(svg).window.document;
}

describe("brandMarkSvg", () => {
	it("renders the navy tile carrying the load-bearing white keyline", () => {
		const rect = parseMark(brandMarkSvg({ fontFamily: FONT })).querySelector("rect");
		assert(rect, "the mark must contain the navy tile rect");
		expect(rect.getAttribute("fill")).toBe("#2B3A55");
		expect(rect.getAttribute("stroke")).toBe("#FFFFFF");
		expect(rect.getAttribute("stroke-opacity")).toBe("0.4");
		expect(rect.getAttribute("stroke-width")).toBe("20");
	});

	it("renders the white ampersand and the amber dot", () => {
		const doc = parseMark(brandMarkSvg({ fontFamily: FONT }));
		const text = doc.querySelector("text");
		assert(text, "the mark must contain the ampersand");
		expect(text.textContent).toBe("&");
		expect(text.getAttribute("fill")).toBe("#FFFFFF");
		const dot = doc.querySelector("circle");
		assert(dot, "the mark must contain the amber dot");
		expect(dot.getAttribute("fill")).toBe("#C8923C");
	});

	it("injects the caller's font-family onto the ampersand", () => {
		const text = parseMark(brandMarkSvg({ fontFamily: "'Noto Serif', serif" })).querySelector("text");
		assert(text, "the mark must contain the ampersand");
		expect(text.getAttribute("font-family")).toBe("'Noto Serif', serif");
	});

	it("emits the classed mark as decorative site chrome (class + aria-hidden + focusable)", () => {
		const svg = parseMark(
			brandMarkSvg({ fontFamily: FONT, className: "header__brand-icon" }),
		).querySelector("svg");
		assert(svg, "svg root must exist");
		expect(svg.getAttribute("class")).toBe("header__brand-icon");
		expect(svg.getAttribute("aria-hidden")).toBe("true");
		expect(svg.getAttribute("focusable")).toBe("false");
	});

	it("emits a bare standalone-asset mark (no class, not aria-hidden) when no className is given", () => {
		const svg = parseMark(brandMarkSvg({ fontFamily: FONT })).querySelector("svg");
		assert(svg, "svg root must exist");
		expect(svg.hasAttribute("class")).toBe(false);
		expect(svg.hasAttribute("aria-hidden")).toBe(false);
		expect(svg.hasAttribute("focusable")).toBe(false);
	});

	it("is a standalone-safe root carrying the xmlns and the 512 viewBox", () => {
		const svg = brandMarkSvg({ fontFamily: FONT });
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('viewBox="0 0 512 512"');
	});
});
