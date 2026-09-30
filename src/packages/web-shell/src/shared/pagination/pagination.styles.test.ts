import { PAGINATION_STYLES } from "./pagination.styles";

describe("PAGINATION_STYLES", () => {
	it("ships the pager stylesheet", () => {
		expect(PAGINATION_STYLES).toContain(".pagination {");
	});

	it("gives the info line its own row on a phone", () => {
		expect(PAGINATION_STYLES).toContain(
			"@media (max-width: 600px) {\n\t.pagination__info {\n\t\tflex-basis: 100%;\n\t}\n}",
		);
	});

	it("hovers only links, so a disabled end or the current page never reacts", () => {
		const hoverSelectors = PAGINATION_STYLES.split("\n").filter((line) => line.includes(":hover"));

		expect(hoverSelectors).toEqual([".pagination__link--enabled:hover {", "a.pagination__page:hover {"]);
	});
});
