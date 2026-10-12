import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { renderHomeCompareSection } from "./home-b-compare.component";
import { HOME_COMPARE_ROWS } from "./home-b-compare.content";

describe("homepage AI comparison", () => {
	it("prices all 11 outcomes from their tokens, including the offline stand-in", () => {
		const inputTokens = HOME_COMPARE_ROWS.reduce((sum, row) => sum + row.inputTokens, 0);
		const outputTokens = HOME_COMPARE_ROWS.reduce((sum, row) => sum + row.outputTokens, 0);
		expect({ inputTokens, outputTokens }).toEqual({ inputTokens: 3_920_500, outputTokens: 408_867 });
		expect(inputTokens * 10 / 1_000_000 + outputTokens * 50 / 1_000_000).toBeCloseTo(59.65, 2);
		const { document } = parseHTML(renderHomeCompareSection());
		const table = document.querySelector(".home-compare__table");
		assert(table);
		expect(table.querySelectorAll("tbody tr").length).toBe(11);
		const total = table.querySelector("tfoot tr");
		assert(total);
		expect(total.textContent).toContain("4,329,367 tokens");
		expect(total.lastElementChild?.textContent).toBe(
			"$0.82 of Claude Max, $4.12 of ChatGPT Pro (about $60 at API list price)",
		);
		const offline = table.querySelector('[data-test-outcome="offline"]');
		assert(offline);
		expect(offline.lastElementChild?.textContent).toBe("Not possible");
		const archive = table.querySelector('[data-test-outcome="archive"]');
		assert(archive);
		expect(archive.lastElementChild?.textContent).toBe("Claude Max: $0.08; ChatGPT Pro: $0.40");
	});

	it("keeps mobile labels aligned with table headings and tracks the closing signup link", () => {
		const { document } = parseHTML(renderHomeCompareSection());
		const headers = Array.from(document.querySelectorAll("thead th"), (cell) => cell.textContent);
		const labels = Array.from(document.querySelectorAll("tbody tr:first-child td"), (cell) =>
			cell.getAttribute("data-label"),
		);
		expect(labels).toEqual(headers.slice(1));
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
