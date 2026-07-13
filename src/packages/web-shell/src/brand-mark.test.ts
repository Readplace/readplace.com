import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { brandMarkSvg } from "./brand-mark";

function parseMark(svg: string): Document {
	return new JSDOM(svg).window.document;
}

describe("brandMarkSvg", () => {
	it("renders the navy tile carrying the load-bearing white keyline", () => {
		const rect = parseMark(brandMarkSvg()).querySelector("rect");
		assert(rect, "the mark must contain the navy tile rect");
		expect(rect.getAttribute("fill")).toBe("#2B3A55");
		expect(rect.getAttribute("stroke")).toBe("#FFFFFF");
		expect(rect.getAttribute("stroke-opacity")).toBe("0.4");
		expect(rect.getAttribute("stroke-width")).toBe("20");
	});

	it("renders the white ampersand as fixed path geometry and the amber dot", () => {
		const doc = parseMark(brandMarkSvg());
		const glyph = doc.querySelector("path");
		assert(glyph, "the mark must contain the ampersand path");
		expect(glyph.getAttribute("fill")).toBe("#FFFFFF");
		expect(glyph.getAttribute("d")).toMatch(/^M204\.28 400Q/);
		const dot = doc.querySelector("circle");
		assert(dot, "the mark must contain the amber dot");
		expect(dot.getAttribute("fill")).toBe("#C8923C");
	});

	it("rests the dot on the palm terminal (fixed position, resting seam)", () => {
		const dot = parseMark(brandMarkSvg()).querySelector("circle");
		assert(dot, "the mark must contain the amber dot");
		expect(dot.getAttribute("cx")).toBe("353");
		expect(dot.getAttribute("cy")).toBe("182");
		expect(dot.getAttribute("r")).toBe("44");
	});

	it("never renders the glyph as font-dependent text", () => {
		expect(brandMarkSvg()).not.toContain("<text");
	});

	it("emits the classed mark as decorative site chrome (class + aria-hidden + focusable)", () => {
		const svg = parseMark(brandMarkSvg({ className: "header__brand-icon" })).querySelector("svg");
		assert(svg, "svg root must exist");
		expect(svg.getAttribute("class")).toBe("header__brand-icon");
		expect(svg.getAttribute("aria-hidden")).toBe("true");
		expect(svg.getAttribute("focusable")).toBe("false");
	});

	it("emits a bare standalone-asset mark (no class, not aria-hidden) when no className is given", () => {
		const svg = parseMark(brandMarkSvg()).querySelector("svg");
		assert(svg, "svg root must exist");
		expect(svg.hasAttribute("class")).toBe(false);
		expect(svg.hasAttribute("aria-hidden")).toBe(false);
		expect(svg.hasAttribute("focusable")).toBe(false);
	});

	it("is a standalone-safe root carrying the xmlns and the 512 viewBox", () => {
		const svg = brandMarkSvg();
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(svg).toContain('viewBox="0 0 512 512"');
	});
});
