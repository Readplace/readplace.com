import { JSDOM } from "jsdom";
import MarkdownIt from "markdown-it";
import { labelTableCells } from "./blog-table-labels";

function bodyRowLabels(markdown: string): (string | null)[][] {
	const md = new MarkdownIt();
	md.core.ruler.push("table_cell_labels", labelTableCells);
	const doc = new JSDOM(md.render(markdown)).window.document;
	return Array.from(doc.querySelectorAll("tbody tr")).map((row) =>
		Array.from(row.querySelectorAll("td")).map((td) => td.getAttribute("data-label")),
	);
}

describe("labelTableCells", () => {
	it("labels each body cell with its header's plain text, leaving the column under an empty corner unlabelled", () => {
		const table = "Intro paragraph.\n\n| | **Readplace** | Readwise |\n| --- | --- | --- |\n| Price | Free | Paid |\n";

		expect(bodyRowLabels(table)).toEqual([[null, "Readplace", "Readwise"]]);
	});

	it("labels the empty cell markdown-it pads a short row with", () => {
		const table = "| Plan | Price | Trial |\n| --- | --- | --- |\n| Pro | $5 |\n";

		expect(bodyRowLabels(table)).toEqual([["Plan", "Price", "Trial"]]);
	});
});
