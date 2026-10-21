import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { describeReaderTables } from "./reader-tables";

function parse(html: string): Element {
	const root = parseHTML(`<!DOCTYPE html><html><body><div id="r">${html}</div></body></html>`).document.querySelector(
		"#r",
	);
	assert(root, "parseHTML must produce the test wrapper div");
	return root;
}

function described(html: string): Element {
	return parse(describeReaderTables(html));
}

function firstTable(root: Element): Element {
	const table = root.querySelector("table");
	assert(table, "the described markup must hold a table");
	return table;
}

function labelsAt(input: { html: string; selector: string }): (string | null)[] {
	return Array.from(described(input.html).querySelectorAll(input.selector), (cell) => cell.getAttribute("data-label"));
}

function labels(html: string): (string | null)[] {
	return labelsAt({ html, selector: "td" });
}

function markedRows(html: string): number[] {
	return Array.from(firstTable(described(html)).querySelectorAll("tr")).flatMap((row, index) =>
		row.hasAttribute("data-reader-header") ? [index] : [],
	);
}

function fits(html: string): boolean {
	return firstTable(described(html)).hasAttribute("data-reader-fits");
}

function word(length: number): string {
	return "x".repeat(length);
}

function words(count: number): string {
	return Array.from({ length: count }, () => "word").join(" ");
}

function twoColumns(input: {
	first: number;
	second: number;
	wrap?: (text: string) => string;
	tag?: "td" | "th";
}): string {
	const wrap = input.wrap ?? ((text: string) => text);
	const tag = input.tag ?? "td";
	return `<table><tbody><tr><${tag}>${wrap(word(input.first))}</${tag}><${tag}>${wrap(word(input.second))}</${tag}></tr></tbody></table>`;
}

function inCode(text: string): string {
	return `<code>${text}</code>`;
}

function headedTable(input: { heading: string; rows: number }): string {
	return `<table><thead><tr><th>${input.heading}</th><th>b</th></tr></thead><tbody>${"<tr><td>1</td><td>2</td></tr>".repeat(input.rows)}</tbody></table>`;
}

function twoHeaderRowsTable(input: { heading: string; rows: number }): string {
	return `<table><thead><tr><th>${input.heading}</th><th>c</th></tr><tr><th>a</th><th>b</th></tr></thead><tbody>${"<tr><td>1</td><td>2</td></tr>".repeat(input.rows)}</tbody></table>`;
}

function firstBodyCell(table: Element): Element {
	const cell = table.querySelector("td");
	assert(cell, "the table must hold a body cell");
	return cell;
}

function fitMarks(html: string): boolean[] {
	return Array.from(described(html).querySelectorAll("table"), (table) => table.hasAttribute("data-reader-fits"));
}

function wideHeadingsTable(columnSpan: number): string {
	return `<table><thead><tr><th colspan="${columnSpan}">a</th><th>b</th></tr></thead><tbody><tr><td colspan="${columnSpan}">1</td><td>2</td></tr></tbody></table>`;
}

function spannedTable(input: { columnSpan: number; rowSpan: number; rows: number }): string {
	return `<table><tr><td colspan="${input.columnSpan}" rowspan="${input.rowSpan}"></td><td></td></tr>${"<tr><td></td></tr>".repeat(input.rows - 1)}</table>`;
}

function emptyHeadedTable(rows: number): string {
	return `<table><thead>${"<tr><th></th><th></th></tr>".repeat(rows)}</thead><tbody>${"<tr><td></td><td></td></tr>".repeat(rows)}</tbody></table>`;
}

function nestedAroundCaption(caption: string): string {
	const open = "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x</td><td>";
	const close = "</td></tr></tbody></table>";
	return `${open}${open}<table><caption>${caption}</caption><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table>${close}${close}`;
}

describe("describeReaderTables", () => {
	it("labels the body cells from a thead row and marks the row as carried", () => {
		const html =
			"<table><thead><tr><th>stage</th><th>owner</th></tr></thead><tbody><tr><td>extract</td><td>parser</td></tr></tbody></table>";
		assert.deepEqual(labels(html), ["stage", "owner"]);
		assert.deepEqual(markedRows(html), [0]);
	});

	it("reads a unique all-th first row as the header", () => {
		const html = "<table><tbody><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>";
		assert.deepEqual(labels(html), ["a", "b"]);
		assert.deepEqual(markedRows(html), [0]);
	});

	it("gives no labels and no marks when all-th rows repeat through the table", () => {
		const html =
			"<table><tbody><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr><tr><th>C</th><th>D</th></tr><tr><td>3</td><td>4</td></tr></tbody></table>";
		assert.deepEqual(labels(html), [null, null, null, null]);
		assert.deepEqual(markedRows(html), []);
	});

	it("gives no labels for row headers alone", () => {
		assert.deepEqual(
			labelsAt({
				html: "<table><tbody><tr><th>words</th><td>2,140</td></tr><tr><th>read time</th><td>9 min</td></tr></tbody></table>",
				selector: "td, th",
			}),
			[null, null, null, null],
		);
	});

	it("labels every column under a colspan heading, and a colspan body cell under it", () => {
		const html =
			'<table><thead><tr><th colspan="2">pair</th><th>solo</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr><tr><td colspan="2">12</td><td>3</td></tr></tbody></table>';
		assert.deepEqual(labels(html), ["pair", "pair", "solo", "pair", "solo"]);
		assert.deepEqual(markedRows(html), [0]);
	});

	it("gives no label to a body cell spanning two headings, so those headings stay visible", () => {
		const html =
			'<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td colspan="2">x</td></tr></tbody></table>';
		assert.deepEqual(labels(html), [null]);
		assert.deepEqual(markedRows(html), []);
	});

	it("places the cells of the rows below a rowspan cell in the columns it leaves free", () => {
		assert.deepEqual(
			labels(
				'<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody><tr><td rowspan="2">x</td><td>y</td><td>z</td></tr><tr><td>y2</td><td>z2</td></tr></tbody></table>',
			),
			["a", "b", "c", "b", "c"],
		);
	});

	it("joins every heading over a cell in a two-row thead, outer to inner, and marks both rows", () => {
		const html =
			'<table><thead><tr><th rowspan="2">name</th><th colspan="2">size</th></tr><tr><th>w</th><th>h</th></tr></thead><tbody><tr><td>n</td><td>1</td><td>2</td></tr></tbody></table>';
		assert.deepEqual(labels(html), ["name", "size · w", "size · h"]);
		assert.deepEqual(markedRows(html), [0, 1]);
	});

	it("labels a body cell across a group's columns with only the group heading", () => {
		const html =
			'<table><thead><tr><th rowspan="2">name</th><th colspan="2">size</th></tr><tr><th>w</th><th>h</th></tr></thead><tbody><tr><td>n</td><td colspan="2">square</td></tr><tr><td>m</td><td>1</td><td>2</td></tr></tbody></table>';
		assert.deepEqual(labels(html), ["name", "size", "name", "size · w", "size · h"]);
	});

	it("reads a heading row of one cell across every column as a title, even above other headings", () => {
		const html =
			'<table><thead><tr><th colspan="2">size</th></tr><tr><th>w</th><th>h</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
		assert.deepEqual(labels(html), ["w", "h"]);
		assert.deepEqual(markedRows(html), [1]);
	});

	it("keeps a title row in the thead out of the labels and visible", () => {
		const html =
			'<table><thead><tr><th colspan="2">Pipeline owners</th></tr><tr><th>stage</th><th>owner</th></tr></thead><tbody><tr><td>render</td><td>web</td></tr></tbody></table>';
		assert.deepEqual(labels(html), ["stage", "owner"]);
		assert.deepEqual(markedRows(html), [1]);
	});

	it("keeps visible a title row leading the all-th rows of a table without a thead", () => {
		const html =
			'<table><tbody><tr><th colspan="2">Totals</th></tr><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>';
		assert.deepEqual(labels(html), ["a", "b"]);
		assert.deepEqual(markedRows(html), [1]);
	});

	it("gives no labels and no marks for a lone title row", () => {
		const withoutHead =
			'<table><tr><th colspan="3">Revision History</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>';
		const withHead =
			'<table><thead><tr><th colspan="2">Syntax</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
		assert.deepEqual(labels(withoutHead), [null, null, null]);
		assert.deepEqual(markedRows(withoutHead), []);
		assert.deepEqual(labels(withHead), [null, null]);
		assert.deepEqual(markedRows(withHead), []);
	});

	it("labels a column of row headers with the heading over it", () => {
		const html =
			"<table><thead><tr><th>Model</th><th>ain</th></tr></thead><tbody><tr><th>whisper</th><td>1.2</td></tr></tbody></table>";
		assert.deepEqual(labelsAt({ html, selector: "tbody th, tbody td" }), ["Model", "ain"]);
		assert.deepEqual(markedRows(html), [0]);
	});

	it("keeps the header row visible when a heading is over a column with nothing in it", () => {
		const html =
			"<table><thead><tr><th>a</th><th>b</th><th>notes</th></tr></thead><tbody><tr><td>1</td><td>2</td><td></td></tr></tbody></table>";
		assert.deepEqual(labels(html), ["a", "b", null]);
		assert.deepEqual(markedRows(html), []);
	});

	it("keeps the header row visible when a heading is an image only", () => {
		const html =
			'<table><thead><tr><th><img src="https://example.com/flag.png" alt=""></th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
		assert.deepEqual(labels(html), [null, "b"]);
		assert.deepEqual(markedRows(html), []);
	});

	it("gives no label to an empty body cell and labels an image-only body cell", () => {
		const out = described(
			'<table><thead><tr><th>a</th><th>b</th><th>c</th></tr></thead><tbody><tr><th>row</th><td> </td><td><img src="https://example.com/i.png" alt=""></td></tr></tbody></table>',
		);
		const rowHeader = out.querySelector("tbody th");
		assert(rowHeader, "the row header must survive");
		assert.equal(rowHeader.getAttribute("data-label"), "a");
		assert.deepEqual(
			Array.from(out.querySelectorAll("td"), (cell) => cell.getAttribute("data-label")),
			[null, "c"],
		);
	});

	it("gives no label from an empty heading, nor to a body cell past the header's last column", () => {
		const html =
			"<table><thead><tr><th></th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>";
		assert.deepEqual(labels(html), [null, "b", null]);
		assert.deepEqual(markedRows(html), [0]);
	});

	it("gives no labels to a table of header rows only and keeps its rows visible", () => {
		const html = "<table><tr><th>a</th><th>b</th></tr><tr><th>c</th><th>d</th></tr></table>";
		assert.deepEqual(labelsAt({ html, selector: "th" }), [null, null, null, null]);
		assert.deepEqual(markedRows(html), []);
	});

	it("removes captured reader attributes", () => {
		const out = described(
			`<table data-reader-fits=""><tbody><tr data-reader-header=""><td data-label="fake">${word(100)}</td><td>y</td></tr></tbody></table><p data-label="x">p</p>`,
		);
		assert.equal(out.querySelectorAll("[data-label]").length, 0);
		assert.equal(out.querySelectorAll("[data-reader-fits]").length, 0);
		assert.equal(out.querySelectorAll("[data-reader-header]").length, 0);
	});

	it("marks a table as fitting only while its estimated width is at most 600px", () => {
		assert.equal(fits(twoColumns({ first: 25, second: 25 })), true);
		assert.equal(fits(twoColumns({ first: 25, second: 26 })), false);
		assert.equal(fits(twoColumns({ first: 24, second: 24, tag: "th" })), true);
		assert.equal(fits(twoColumns({ first: 24, second: 25, tag: "th" })), false);
		assert.equal(fits(twoColumns({ first: 30, second: 29, wrap: inCode })), true);
		assert.equal(fits(twoColumns({ first: 30, second: 30, wrap: inCode })), false);
		assert.equal(
			fits(`<table><tbody><tr><td>${inCode(word(8))}</td><td>${word(44)}</td></tr></tbody></table>`),
			true,
		);
		assert.equal(
			fits(`<table><tbody><tr><td><pre>${word(54)}\nshort line with spaces</pre></td><td>x</td></tr></tbody></table>`),
			true,
		);
		assert.equal(fits(`<table><tbody><tr><td><pre>${word(55)}</pre></td><td>x</td></tr></tbody></table>`), false);
		assert.equal(
			fits(`<table><tbody><tr><td><pre>${"a ".repeat(40)}</pre></td><td>x</td></tr></tbody></table>`),
			false,
		);
		assert.equal(fits(`<table><tbody><tr><td><ul><li>${word(47)}</li></ul></td><td>x</td></tr></tbody></table>`), true);
		assert.equal(
			fits(`<table><tbody><tr><td><ul><li>${word(48)}</li></ul></td><td>x</td></tr></tbody></table>`),
			false,
		);
		assert.equal(
			fits(`<table><caption>${word(56)}</caption><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`),
			true,
		);
		assert.equal(
			fits(`<table><caption>${word(57)}</caption><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`),
			false,
		);
		assert.equal(
			fits(`<table><tbody><tr><td>a</td><td>b</td></tr><tr><td colspan="2">${word(53)}</td></tr></tbody></table>`),
			true,
		);
		assert.equal(
			fits(`<table><tbody><tr><td>a</td><td>b</td></tr><tr><td colspan="2">${word(54)}</td></tr></tbody></table>`),
			false,
		);
		assert.equal(
			fits(
				`<table><tbody><tr><td colspan="2">${word(49)}</td></tr><tr><td colspan="2">x</td><td>y</td></tr></tbody></table>`,
			),
			true,
		);
		assert.equal(
			fits(
				`<table><tbody><tr><td colspan="2">${word(50)}</td></tr><tr><td colspan="2">x</td><td>y</td></tr></tbody></table>`,
			),
			false,
		);
		assert.equal(fits(`<table><tbody><tr><td>${"x&nbsp;".repeat(30)}</td><td>y</td></tr></tbody></table>`), false);
	});

	it("estimates keyboard and sample text at the code glyph width", () => {
		assert.equal(fits(twoColumns({ first: 30, second: 29, wrap: (text) => `<kbd>${text}</kbd>` })), true);
		assert.equal(fits(twoColumns({ first: 30, second: 29, wrap: (text) => `<samp>${text}</samp>` })), true);
	});

	it("counts an invalid span as one and survives a huge one", () => {
		assert.deepEqual(
			labels(
				'<table><thead><tr><th colspan="0">a</th><th colspan="abc">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
			),
			["a", "b"],
		);
		assert.doesNotThrow(() =>
			describeReaderTables('<table><tbody><tr><td colspan="5000" rowspan="70000">x</td></tr></tbody></table>'),
		);
	});

	it("describes nested tables on their own", () => {
		const out = described(
			"<table><thead><tr><th>outer</th><th>o2</th></tr></thead><tbody><tr><td><table><thead><tr><th>inner</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table></td><td>w</td></tr></tbody></table>",
		);
		assert.deepEqual(
			Array.from(out.querySelectorAll("td"), (cell) => cell.getAttribute("data-label")),
			["outer", null, "o2"],
		);
		assert.equal(out.querySelectorAll("table[data-reader-fits]").length, 1);
		assert.equal(out.querySelectorAll("table table[data-reader-flow]").length, 1);
		assert.equal(out.querySelectorAll("table table [data-reader-header]").length, 0);
	});

	it("leaves markup without tables unchanged", () => {
		const html = '<p>Hello <a href="https://example.com/a">a link</a></p><ul><li>one</li></ul>';
		assert.equal(describeReaderTables(html), html);
	});

	it("estimates the hostile e2e fixture: the wide table does not fit, the split-bodies and row-header tables do", () => {
		const headings = ["checksum", "artefact", "platform", "toolchain", "size", "built", "signer", "status"];
		const row = [
			"0xa41f9c72e5d8b1",
			"reader-core",
			"darwin-arm64",
			"clang-19.1.0",
			"18.4MB",
			"2026-04-02",
			"release-bot",
			"verified",
		];
		const wide = `<table><thead><tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody><tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr></tbody></table>`;
		assert.equal(fits(wide), false);
		assert.equal(
			fits(
				"<table><thead><tr><th>stage</th><th>owner</th></tr></thead><tbody><tr><td>extract</td><td>parser</td></tr><tr><td>sanitise</td><td>reader</td></tr></tbody><tbody><tr><td>render</td><td>web</td></tr></tbody></table>",
			),
			true,
		);
		assert.equal(
			fits(
				"<table><tbody><tr><th>words</th><td>2,140</td></tr><tr><th>read time</th><td>9 min</td></tr></tbody></table>",
			),
			true,
		);
		assert.deepEqual(labels(wide), headings);
		assert.deepEqual(markedRows(wide), [0]);
	});

	it("reads rows written straight under the table, with no tbody in the markup", () => {
		assert.deepEqual(labels("<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>"), ["a", "b"]);
	});

	it("marks a one-column table as flow, with no labels, no header marks and no fit mark", () => {
		const out = described(
			'<table><thead><tr><th>Notes</th></tr></thead><tbody><tr><td>a</td></tr><tr><td colspan="3">b</td></tr></tbody></table><table></table>',
		);
		const [first, empty] = Array.from(out.querySelectorAll("table"));
		assert(first && empty, "both tables must survive");
		assert.equal(first.hasAttribute("data-reader-flow"), true);
		assert.equal(first.hasAttribute("data-reader-fits"), false);
		assert.equal(out.querySelectorAll("[data-label], [data-reader-header]").length, 0);
		assert.equal(empty.hasAttribute("data-reader-flow"), true);
	});

	it("keeps a table with one row of two cells a table", () => {
		const table = firstTable(
			described('<table><tbody><tr><td colspan="2">hunk</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>'),
		);
		assert.equal(table.hasAttribute("data-reader-flow"), false);
		assert.equal(table.hasAttribute("data-reader-fits"), true);
	});

	it("removes a captured flow mark", () => {
		const table = firstTable(described('<table data-reader-flow=""><tr><td>a</td><td>b</td></tr></table>'));
		assert.equal(table.hasAttribute("data-reader-flow"), false);
	});

	it("labels a table whose labels add exactly three times the body's length to the HTML, and leaves one past it unlabelled with its header row shown", () => {
		const atBudget = headedTable({ heading: word(451), rows: 4 });
		const pastBudget = headedTable({ heading: word(452), rows: 4 });
		assert.deepEqual(labels(atBudget), Array.from({ length: 4 }, () => [word(451), "b"]).flat());
		assert.deepEqual(markedRows(atBudget), [0]);
		assert.deepEqual(labels(pastBudget), Array.from({ length: 8 }, () => null));
		assert.deepEqual(markedRows(pastBudget), []);
	});

	it("measures a label as the HTML writes it, each quote, ampersand and angle bracket as long as the longest escape", () => {
		const escapes = '"&amp;&lt;&gt;';
		assert.equal(labels(headedTable({ heading: word(22), rows: 4 }))[0], word(22));
		assert.equal(labels(headedTable({ heading: '"'.repeat(22), rows: 4 }))[0], null);
		assert.equal(labels(headedTable({ heading: escapes.repeat(8), rows: 4 }))[0], '"&<>'.repeat(8));
		assert.equal(labels(headedTable({ heading: escapes.repeat(9), rows: 4 }))[0], null);
	});

	it("measures a label joined from two header rows with the separator between its headings", () => {
		assert.equal(labels(twoHeaderRowsTable({ heading: word(506), rows: 4 }))[0], `${word(506)} · a`);
		assert.equal(labels(twoHeaderRowsTable({ heading: word(507), rows: 4 }))[0], null);
	});

	it("spends one budget on a body's tables in order, so a table past what is left gets no labels and the tables around it keep theirs", () => {
		const heading = "ab ".repeat(250);
		const tables = Array.from(
			described(
				headedTable({ heading, rows: 4 }) + headedTable({ heading, rows: 4 }) + headedTable({ heading: "a", rows: 1 }),
			).querySelectorAll("table"),
		);
		assert.deepEqual(
			tables.map((table) => firstBodyCell(table).getAttribute("data-label")),
			[heading.trim(), null, "a"],
		);
		assert.deepEqual(
			tables.map((table) => Array.from(table.querySelectorAll("tr")).some((row) => row.hasAttribute("data-reader-header"))),
			[true, false, true],
		);
		assert.deepEqual(
			tables.map((table) => table.hasAttribute("data-reader-fits")),
			[true, true, true],
		);
	});

	it("describes a table whose work is exactly twice the HTML the step receives, and leaves one past it undescribed with its headings shown", () => {
		const atBudget = wideHeadingsTable(125);
		const pastBudget = wideHeadingsTable(126);
		assert.deepEqual(labels(atBudget), ["a", "b"]);
		assert.deepEqual(markedRows(atBudget), [0]);
		assert.equal(fits(atBudget), true);
		assert.deepEqual(labels(pastBudget), [null, null]);
		assert.deepEqual(markedRows(pastBudget), []);
		assert.equal(fits(pastBudget), false);
	});

	it("counts a cell's grid slots in every row it spans, up to the table's last row", () => {
		assert.equal(fits(spannedTable({ columnSpan: 68, rowSpan: 2, rows: 3 })), true);
		assert.equal(fits(spannedTable({ columnSpan: 68, rowSpan: 3, rows: 3 })), false);
		assert.equal(fits(spannedTable({ columnSpan: 68, rowSpan: 9, rows: 2 })), true);
	});

	it("counts a heading lookup for every body cell under every header row, so a table of as many header rows as body rows is described up to 52 of each", () => {
		assert.deepEqual(
			markedRows(emptyHeadedTable(52)),
			Array.from({ length: 52 }, (_, index) => index),
		);
		assert.equal(fits(emptyHeadedTable(52)), true);
		assert.deepEqual(markedRows(emptyHeadedTable(53)), []);
		assert.equal(fits(emptyHeadedTable(53)), false);
	});

	it("reads a nested table again for every table around it, caption included, so the innermost of three tables around a caption of 113 words is left undescribed", () => {
		const atBudget = nestedAroundCaption(words(112));
		const pastBudget = nestedAroundCaption(words(113));
		assert.deepEqual(fitMarks(atBudget), [true, true, true]);
		assert.deepEqual(labelsAt({ html: atBudget, selector: "td:first-child" }), ["a", "a", "a"]);
		assert.deepEqual(fitMarks(pastBudget), [true, true, false]);
		assert.deepEqual(labelsAt({ html: pastBudget, selector: "td:first-child" }), ["a", "a", null]);
	});

	it("counts every node a read walks, so of 50 empty tables nested in one another only the outer 30 are described", () => {
		const html = `${"<table><tr><td></td><td>".repeat(50)}${"</td></tr></table>".repeat(50)}`;
		assert.deepEqual(fitMarks(html), [
			...Array.from({ length: 30 }, () => true),
			...Array.from({ length: 20 }, () => false),
		]);
	});

	it("describes no table after one whose work passes the budget, and still flows a one-column table", () => {
		const out = described(
			`<table><tr><td colspan="1000"></td><td></td></tr></table>${headedTable({ heading: "a", rows: 1 })}<table><tr><td>flow</td></tr></table>`,
		);
		const [wide, headed, flow] = Array.from(out.querySelectorAll("table"));
		assert(wide && headed && flow, "all three tables must survive");
		assert.equal(wide.hasAttribute("data-reader-fits"), false);
		assert.equal(firstBodyCell(headed).getAttribute("data-label"), null);
		assert.equal(headed.querySelector("[data-reader-header]"), null);
		assert.equal(headed.hasAttribute("data-reader-fits"), false);
		assert.equal(flow.hasAttribute("data-reader-flow"), true);
	});
});
