import { MENU_STYLES } from "./menu.styles";

describe("MENU_STYLES", () => {
	it("divides only the visible panel children with a one-pixel hairline", () => {
		expect(MENU_STYLES).toContain(".menu__panel {");
		expect(MENU_STYLES).toContain("gap: 1px;");
		expect(MENU_STYLES).toContain("background: var(--border);");
	});

	it("draws menu focus inside the clipped panel", () => {
		expect(MENU_STYLES).toContain(".menu__item:focus-visible {");
		expect(MENU_STYLES).toContain("outline-offset: -2px;");
	});
});
