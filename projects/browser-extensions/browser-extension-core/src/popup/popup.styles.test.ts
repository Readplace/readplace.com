import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_SYSTEM_STYLES } from "@packages/web-shell/design-system.styles";

const stylesheet = readFileSync(
	join(__dirname, "..", "..", "src", "popup", "popup.styles.css"),
	"utf-8",
);

function declarationsOf(selector: string): string {
	const start = stylesheet.indexOf(`\n${selector} {`);
	expect(start).not.toBe(-1);
	return stylesheet.slice(start, stylesheet.indexOf("}", start));
}

function horizontalPaddingOf(selector: string): number {
	const shorthand = /padding:\s*\S+\s+(\S+)/.exec(declarationsOf(selector));
	expect(shorthand).not.toBeNull();
	return Number.parseFloat(String(shorthand?.[1]));
}

/**
 * The popup body is a fixed 350px canvas with no padding of its own, so a view
 * that owns its own layout has to reserve the gutter itself. `.saved-view` is
 * shared by the single-save and the bulk-save views, so a missing gutter shows
 * up wherever the copy is long enough to fill the width — which is why the
 * bulk-save view exposed it first.
 */
describe("popup gutters", () => {
	it("holds the saved and save-all views off the popup edge, like every other view", () => {
		expect(horizontalPaddingOf(".saved-view")).toBeGreaterThan(0);
		expect(horizontalPaddingOf(".saved-view")).toBe(horizontalPaddingOf(".saving-view"));
		expect(horizontalPaddingOf(".saved-view")).toBe(horizontalPaddingOf(".login"));
	});

	it("wraps the bulk-save detail line, whose text is a raw URL long enough to overflow", () => {
		expect(declarationsOf(".saved-view__subtitle")).toMatch(/overflow-wrap:\s*anywhere/);
	});
});

function declaredProperties(css: string): Set<string> {
	return new Set(Array.from(css.matchAll(/(--[a-z0-9-]+)\s*:/g), (match) => match[1]));
}

describe("popup tokens", () => {
	it("names only tokens the build's design system or the stylesheet itself declares", () => {
		const declared = new Set([...declaredProperties(DESIGN_SYSTEM_STYLES), ...declaredProperties(stylesheet)]);
		const referenced = Array.from(stylesheet.matchAll(/var\((--[a-z0-9-]+)/g), (match) => match[1]);

		expect(referenced.filter((name) => !declared.has(name))).toEqual([]);
	});

	it("carries no rule that must come first, so the build can put the design system ahead of it", () => {
		expect(stylesheet).not.toMatch(/@import|@charset/);
	});
});
