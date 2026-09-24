import { parseHTML } from "linkedom";
import { renderIllustration } from "./illustrations";

function rootOf(svg: string) {
	const { document } = parseHTML(svg);
	return document.documentElement;
}

describe("renderIllustration", () => {
	it("draws the book with a lightbulb as a standalone <svg> hidden from assistive tech", () => {
		const root = rootOf(renderIllustration("book-lightbulb"));
		expect(root.localName).toBe("svg");
		expect(root.getAttribute("aria-hidden")).toBe("true");
		expect(root.getAttribute("focusable")).toBe("false");
		expect(root.getAttribute("viewBox")).toBe("0 0 120 96");
	});

	it("draws the trash can as a standalone <svg> hidden from assistive tech", () => {
		const root = rootOf(renderIllustration("trash-can"));
		expect(root.localName).toBe("svg");
		expect(root.getAttribute("aria-hidden")).toBe("true");
		expect(root.getAttribute("focusable")).toBe("false");
		expect(root.getAttribute("viewBox")).toBe("0 0 72 80");
	});

	it("sizes every drawing by its container rather than a fixed width", () => {
		for (const name of ["book-lightbulb", "trash-can"] as const) {
			const root = rootOf(renderIllustration(name));
			expect(root.hasAttribute("width")).toBe(false);
			expect(root.hasAttribute("height")).toBe(false);
		}
	});
});
