import { parseHTML } from "linkedom";
import { type IllustrationName, renderIllustration } from "./illustrations";

const NAMES: readonly IllustrationName[] = ["book-lightbulb", "trash-can"];

const INK = "currentColor";
const PAPER = "var(--card)";
const AMBER = "var(--color-brand)";
const CREAM = "var(--color-brand-light)";

function rootOf(svg: string) {
	const { document } = parseHTML(svg);
	return document.documentElement;
}

function shapesOf(name: IllustrationName) {
	return Array.from(rootOf(renderIllustration(name)).querySelectorAll("*"));
}

describe("renderIllustration", () => {
	it("draws the book with a lightbulb as a standalone <svg> hidden from assistive tech", () => {
		const root = rootOf(renderIllustration("book-lightbulb"));
		expect(root.localName).toBe("svg");
		expect(root.getAttribute("aria-hidden")).toBe("true");
		expect(root.getAttribute("focusable")).toBe("false");
		expect(root.getAttribute("viewBox")).toBe("0 0 80 64");
	});

	it("draws the trash can as a standalone <svg> hidden from assistive tech", () => {
		const root = rootOf(renderIllustration("trash-can"));
		expect(root.localName).toBe("svg");
		expect(root.getAttribute("aria-hidden")).toBe("true");
		expect(root.getAttribute("focusable")).toBe("false");
		expect(root.getAttribute("viewBox")).toBe("0 0 46 64");
	});

	it("carries the size it was drawn at, 64px tall, so every surface renders it unscaled", () => {
		for (const name of NAMES) {
			const root = rootOf(renderIllustration(name));
			const [, , viewBoxWidth, viewBoxHeight] = String(root.getAttribute("viewBox")).split(" ");
			expect(root.getAttribute("height")).toBe("64");
			expect(root.getAttribute("height")).toBe(viewBoxHeight);
			expect(root.getAttribute("width")).toBe(viewBoxWidth);
		}
	});

	it("names each drawing for the tests that look for it", () => {
		for (const name of NAMES) {
			expect(rootOf(renderIllustration(name)).getAttribute("data-test-illustration")).toBe(name);
		}
	});

	it("paints only with theme roles, so the art follows the reader's theme and the light pin", () => {
		for (const name of NAMES) {
			for (const shape of shapesOf(name)) {
				expect([INK, PAPER, AMBER, CREAM]).toContain(shape.getAttribute("fill"));
			}
		}
	});

	it("keeps each drawing to the palette it was drawn in", () => {
		const paletteOf = (name: IllustrationName) =>
			[...new Set(shapesOf(name).map((shape) => shape.getAttribute("fill")))].sort();

		expect(paletteOf("book-lightbulb")).toEqual([INK, AMBER, PAPER].sort());
		expect(paletteOf("trash-can")).toEqual([INK, AMBER, CREAM, PAPER].sort());
	});

	it("draws with flat filled shapes only, so a page can inline it once per card", () => {
		const allowedAttributes: Record<string, readonly string[]> = {
			path: ["d", "fill", "fill-rule", "clip-rule"],
			circle: ["cx", "cy", "r", "fill"],
			ellipse: ["cx", "cy", "rx", "ry", "fill"],
		};
		for (const name of NAMES) {
			for (const shape of shapesOf(name)) {
				expect(Object.keys(allowedAttributes)).toContain(shape.localName);
				expect(shape.parentElement?.localName).toBe("svg");
				for (const attribute of shape.getAttributeNames()) {
					expect(allowedAttributes[shape.localName]).toContain(attribute);
				}
			}
		}
	});
});
