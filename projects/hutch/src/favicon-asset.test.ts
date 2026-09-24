import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandMarkSmallSvg } from "@packages/web-shell";
import { JSDOM } from "jsdom";

/** favicon.svg is a hand-maintained copy of the Readplace mark: a static asset
 * cannot import brandMarkSvg (from @packages/web-shell), so its keyline is
 * duplicated by hand. This guards that copy against drifting from the keyline
 * every other surface carries — a dropped stroke or a lightened fill would
 * re-ship the "navy tile dissolves on a dark browser tab strip" bug here alone.
 * The compiled test lives at dist/; static-assets is its sibling. */
const svg = readFileSync(join(__dirname, "..", "static-assets", "favicon.svg"), "utf-8");

describe("favicon.svg brand mark", () => {
	it("carries the white keyline that keeps the navy tile visible on a dark tab strip", () => {
		expect(svg).toContain('stroke="#FFFFFF"');
		expect(svg).toContain('stroke-opacity="0.4"');
		expect(svg).toContain('stroke-width="20"');
	});

	it("keeps the navy tile fill — the keyline delineates the tile, it never lightens the fill", () => {
		expect(svg).toContain('fill="#2B3A55"');
	});

	it("draws the same small-size glyph the shared dotless mark serves at /embed/icon-small.svg", () => {
		const faviconGlyph = new JSDOM(svg).window.document.querySelector("path");
		const sharedGlyph = new JSDOM(brandMarkSmallSvg()).window.document.querySelector("path");
		assert(faviconGlyph, "favicon.svg must contain the ampersand path");
		assert(sharedGlyph, "brandMarkSmallSvg must contain the ampersand path");
		expect(faviconGlyph.getAttribute("d")).toBe(sharedGlyph.getAttribute("d"));
	});
});
