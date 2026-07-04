import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The compiled test lives at dist/popup/; the source CSS it guards is the
 * sibling under src/. The two glyph tiles (.login__icon, .list-view__brand-icon)
 * are CSS-drawn on a navy #2B3A55 fill — NOT the SVG mark — so this box-shadow
 * ring is their only keyline. Without it the tiles dissolve into the dark popup
 * (--popup-bg #1A2332), the exact bug the ring fixes. Guard both against removal. */
const css = readFileSync(join(__dirname, "..", "..", "src", "popup", "popup.styles.css"), "utf-8");

function ruleBody(selector: string): string {
	const match = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`));
	assert(match, `.${selector} rule must exist in popup.styles.css`);
	return match[1];
}

describe("popup keyline ring", () => {
	it("defines the white icon-keyline token", () => {
		expect(css).toContain("--popup-icon-ring: rgba(255, 255, 255, 0.4);");
	});

	it("rings the login glyph tile so its navy fill stays visible on the dark popup", () => {
		expect(ruleBody("login__icon")).toContain("box-shadow: 0 0 0 1px var(--popup-icon-ring)");
	});

	it("rings the list-view glyph tile so its navy fill stays visible on the dark popup", () => {
		expect(ruleBody("list-view__brand-icon")).toContain(
			"box-shadow: 0 0 0 1px var(--popup-icon-ring)",
		);
	});
});
