import { tableToMarkdown } from "./table-to-markdown";

describe("tableToMarkdown", () => {
	it("writes a table whose cells each fit on one line as a GFM table without padding", () => {
		const markdown = tableToMarkdown({
			outsideCells: "",
			caption: "",
			rows: [
				["Plan", "Price"],
				["Readplace", "$49/yr"],
				["A plan with a much longer name than the rest", "$9.99"],
			],
		});

		expect(markdown).toBe(
			[
				"| Plan | Price |",
				"| --- | --- |",
				"| Readplace | $49/yr |",
				"| A plan with a much longer name than the rest | $9.99 |",
			].join("\n"),
		);
	});

	it("pads only the header row, so a renderer keeps the cells of the widest row", () => {
		const markdown = tableToMarkdown({
			outsideCells: "",
			caption: "",
			rows: [["Version"], ["1.0", "2026-01-15", "Initial release"], ["1.1"]],
		});

		expect(markdown).toBe(
			[
				"| Version |  |  |",
				"| --- | --- | --- |",
				"| 1.0 | 2026-01-15 | Initial release |",
				"| 1.1 |",
			].join("\n"),
		);
	});

	it("writes a line break inside a cell as <br> and escapes every pipe", () => {
		const markdown = tableToMarkdown({
			outsideCells: "",
			caption: "",
			rows: [
				["Property", "Type"],
				["author", "Person or  \nOrganization"],
				["`a|b`", "x | y | z"],
			],
		});

		expect(markdown).toBe(
			[
				"| Property | Type |",
				"| --- | --- |",
				"| author | Person or<br>Organization |",
				"| `a\\|b` | x \\| y \\| z |",
			].join("\n"),
		);
	});

	it("writes every cell in reading order when one cell holds more than one line", () => {
		const markdown = tableToMarkdown({
			outsideCells: "",
			caption: "",
			rows: [
				["2.0", "2026-03-31"],
				["* Added dark mode\n* Fixed a crash on start"],
			],
		});

		expect(markdown).toBe(
			"2.0\n\n2026-03-31\n\n* Added dark mode\n* Fixed a crash on start",
		);
	});

	it("writes a table with a single row in reading order", () => {
		const markdown = tableToMarkdown({
			outsideCells: "",
			caption: "",
			rows: [["Price", "$49/yr"]],
		});

		expect(markdown).toBe("Price\n\n$49/yr");
	});

	it("leaves out rows and cells that have no content", () => {
		const gfm = tableToMarkdown({
			outsideCells: "",
			caption: "",
			rows: [
				["", ""],
				["Plan", "Price"],
				["Readplace", "$49/yr"],
			],
		});
		const readingOrder = tableToMarkdown({
			outsideCells: "",
			caption: "",
			rows: [
				["First paragraph.\n\nSecond paragraph.", ""],
				[""],
				["", "A reply."],
			],
		});

		expect(gfm).toBe("| Plan | Price |\n| --- | --- |\n| Readplace | $49/yr |");
		expect(readingOrder).toBe(
			"First paragraph.\n\nSecond paragraph.\n\nA reply.",
		);
	});

	it("writes the content found outside the cells, then the caption, before the table", () => {
		const markdown = tableToMarkdown({
			outsideCells: "Prices as of 2026",
			caption: "Plans",
			rows: [
				["Plan", "Price"],
				["Readplace", "$49/yr"],
			],
		});

		expect(markdown).toBe(
			"Prices as of 2026\n\nPlans\n\n| Plan | Price |\n| --- | --- |\n| Readplace | $49/yr |",
		);
	});

	it("writes nothing for a table without content", () => {
		expect(
			tableToMarkdown({ outsideCells: "", caption: "", rows: [["", ""], []] }),
		).toBe("");
	});

	it("costs a fixed number of characters per cell and column on top of the cells, however wide a cell is", () => {
		const wide = "word ".repeat(1_000).trim();
		const rows = [
			["a", "b", "c"],
			[wide, "d", "e"],
			["f", wide, "g"],
		];
		const cellCharacters = rows
			.flat()
			.reduce((sum, cell) => sum + cell.length, 0);

		const markdown = tableToMarkdown({ outsideCells: "", caption: "", rows });

		expect(markdown.length).toBeLessThanOrEqual(
			cellCharacters + 4 * rows.flat().length + 6 * 3 + rows.length + 1,
		);
	});
});
