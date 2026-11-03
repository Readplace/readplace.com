import assert from "node:assert/strict";
import { iconSvg } from "@packages/ui-icons";
import { parseHTML } from "linkedom";
import { renderHomeCompareSection } from "./home-b-compare.component";
import { PRICE_STATEMENT, SAVES_STAY_STATEMENT } from "../../price-statement";
import { HOME_COMPARE_CONTENT, HOME_COMPARE_FEATURES } from "./home-b-compare.content";

function parsedGlyph(svg: string): string | undefined {
	return parseHTML(`<span>${svg}</span>`).document.querySelector("svg")?.outerHTML;
}

function renderTable(): Element {
	const { document } = parseHTML(renderHomeCompareSection());
	const table = document.querySelector(".home-compare__table");
	assert(table);
	return table;
}

describe("homepage AI comparison", () => {
	it("headlines the $5 the way the price statement states it", () => {
		const { document } = parseHTML(renderHomeCompareSection());
		expect(document.querySelector("h2")?.textContent).toBe(
			"Your reading list for $5 a month, billed yearly — not $200 a month.",
		);
	});

	it("reassures with the price statement and what happens to saves", () => {
		const { document } = parseHTML(renderHomeCompareSection());
		expect(document.querySelector(".home-compare__reassurance")?.textContent).toBe(
			`${PRICE_STATEMENT} ${SAVES_STAY_STATEMENT}`,
		);
	});

	it("prices Readplace's yearly plan against both $200 plans per month and per year", () => {
		const table = renderTable();
		const prices = Array.from(table.querySelectorAll('[data-test-compare-row="month"], [data-test-compare-row="year"]'), (row) =>
			Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent),
		);
		expect(prices).toEqual([
			["Per month", "$5", "$200", "$200"],
			["Per year", "$60", "$2,400", "$2,400"],
		]);
	});

	it("ticks every feature row for Readplace and crosses it for both AI plans", () => {
		const table = renderTable();
		const features = HOME_COMPARE_FEATURES.map((feature) => {
			const row = table.querySelector(`[data-test-compare-row="${feature.key}"]`);
			assert(row, `the ${feature.key} row must render`);
			return {
				label: row.querySelector("th")?.textContent,
				answers: Array.from(row.querySelectorAll("td"), (cell) => ({
					glyph: cell.querySelector("svg")?.outerHTML,
					text: cell.querySelector(".sr-only")?.textContent,
				})),
			};
		});
		const yes = { glyph: parsedGlyph(iconSvg("check")), text: "Yes" };
		const no = { glyph: parsedGlyph(iconSvg("x")), text: "No" };
		expect(features).toEqual(HOME_COMPARE_FEATURES.map((feature) => ({ label: feature.label, answers: [yes, no, no] })));
		expect(table.querySelectorAll("tbody tr").length).toBe(2 + HOME_COMPARE_FEATURES.length);
	});

	it("keeps mobile labels aligned with table headings and tracks the closing signup link", () => {
		const { document } = parseHTML(renderHomeCompareSection());
		const headers = Array.from(document.querySelectorAll("thead th"), (cell) => cell.textContent);
		expect(headers).toEqual([
			HOME_COMPARE_CONTENT.columns.feature,
			HOME_COMPARE_CONTENT.columns.readplace,
			HOME_COMPARE_CONTENT.columns.claude,
			HOME_COMPARE_CONTENT.columns.chatgpt,
		]);
		for (const row of document.querySelectorAll("tbody tr")) {
			const labels = Array.from(row.querySelectorAll("td"), (cell) => cell.getAttribute("data-label"));
			expect(labels).toEqual(headers.slice(1));
		}
		expect(Array.from(document.querySelectorAll("thead th"), (cell) => cell.getAttribute("scope")))
			.toEqual(["col", "col", "col", "col"]);
		const signup = document.querySelector('[data-test-cta="compare-signup"]');
		assert(signup);
		const href = signup.getAttribute("href");
		assert(href);
		const destination = new URL(href, "https://readplace.com");
		expect(destination.pathname).toBe("/signup");
		expect(Object.fromEntries(destination.searchParams)).toEqual({
			utm_source: "home-compare",
			utm_medium: "internal",
			utm_content: "compare-signup",
		});
	});
});
