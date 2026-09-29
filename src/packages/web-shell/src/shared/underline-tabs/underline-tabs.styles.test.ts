import { UNDERLINE_TABS_STYLES } from "./underline-tabs.styles";

describe("UNDERLINE_TABS_STYLES", () => {
	it("keys the open tab on aria-current, so style and accessibility state cannot drift", () => {
		expect(UNDERLINE_TABS_STYLES).toContain(
			'.underline-tabs__tab[aria-current="page"] {\n\tfont-weight: 600;\n\tcolor: var(--foreground);\n\tborder-bottom-color: var(--foreground);\n}',
		);
	});

	it("inks a resting tab label with the inactive-tab role token", () => {
		expect(UNDERLINE_TABS_STYLES).toContain("color: var(--ink-tab-inactive);");
	});

	it("reaches the 44px tab floor through a hit area on a 40px painted box", () => {
		expect(UNDERLINE_TABS_STYLES).toContain(
			'.underline-tabs__tab::before {\n\tcontent: "";\n\tposition: absolute;\n\tinset: -2px 0;\n}',
		);
	});

	it("gives the pressed tab the open look after returning the old open tab to rest", () => {
		const restIndex = UNDERLINE_TABS_STYLES.indexOf(
			'.underline-tabs.htmx-request .underline-tabs__tab[aria-current="page"] {',
		);
		const pressedIndex = UNDERLINE_TABS_STYLES.indexOf(
			".underline-tabs.htmx-request .underline-tabs__tab.htmx-request {",
		);
		expect(restIndex).toBeGreaterThan(0);
		expect(pressedIndex).toBeGreaterThan(restIndex);
	});

	it("narrows the side padding of a dense strip to 12px", () => {
		expect(UNDERLINE_TABS_STYLES).toContain(
			".underline-tabs--dense .underline-tabs__tab {\n\tpadding-inline: 12px;\n}",
		);
	});

	it("splits the strip equally on a phone", () => {
		expect(UNDERLINE_TABS_STYLES).toContain(
			"@media (max-width: 600px) {\n\t.underline-tabs__tab {\n\t\tflex: 1 1 0;\n\t\tjustify-content: center;",
		);
	});
});
