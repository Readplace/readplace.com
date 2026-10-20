import { codeSpanOnOneLine } from "./code-span-on-one-line";
import {
	initHtmlToMarkdown,
	type TableToMarkdown,
} from "./markdown-conversion";

function recordingTableToMarkdown(
	written: (table: Parameters<TableToMarkdown>[0]) => string,
) {
	const tables: Parameters<TableToMarkdown>[0][] = [];
	const tableToMarkdown: TableToMarkdown = (table) => {
		tables.push(table);
		return written(table);
	};
	return { tables, tableToMarkdown };
}

describe("initHtmlToMarkdown", () => {
	it("writes what tableToMarkdown returns in place of the table", () => {
		const htmlToMarkdown = initHtmlToMarkdown({
			tableToMarkdown: () => "TABLE MARKDOWN",
			codeSpanOnOneLine,
		});

		const markdown = htmlToMarkdown(
			"<p>Before</p><table><tr><td>Readplace</td></tr></table><p>After</p>",
		);

		expect(markdown).toBe("Before\n\nTABLE MARKDOWN\n\nAfter");
	});

	it("hands tableToMarkdown every cell as the same markup renders outside a table", () => {
		const { tables, tableToMarkdown } = recordingTableToMarkdown(() => "");
		const htmlToMarkdown = initHtmlToMarkdown({
			tableToMarkdown,
			codeSpanOnOneLine,
		});
		const cells = [
			"<ul><li>Added <b>dark mode</b></li><li>Fixed a crash</li></ul>",
			"<p>First paragraph.</p><p>Second paragraph.</p>",
			"<pre><code>npm install\n  --save</code></pre>",
			'<a href="/plans">Plans</a> start at<br>$49/yr <svg><title>Icon</title></svg>',
		];

		htmlToMarkdown(
			`<table><tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr></table>`,
		);

		expect(tables).toEqual([
			{ outsideCells: "", caption: "", rows: [cells.map(htmlToMarkdown)] },
		]);
	});

	it("hands a nested table to tableToMarkdown before the cell that holds it", () => {
		const { tables, tableToMarkdown } = recordingTableToMarkdown((table) =>
			table.rows.map((row) => row.join("+")).join("/"),
		);
		const htmlToMarkdown = initHtmlToMarkdown({
			tableToMarkdown,
			codeSpanOnOneLine,
		});

		const markdown = htmlToMarkdown(
			"<table><tr><td><table><tr><td>inner a</td><td>inner b</td></tr></table></td><td>outer</td></tr></table>",
		);

		expect(tables.map((table) => table.rows)).toEqual([
			[["inner a", "inner b"]],
			[["inner a+inner b", "outer"]],
		]);
		expect(markdown).toBe("inner a+inner b+outer");
	});

	it("hands a cell that opens inside another cell to tableToMarkdown as the next cell of its row, as a browser builds it", () => {
		const { tables, tableToMarkdown } = recordingTableToMarkdown(() => "");
		const htmlToMarkdown = initHtmlToMarkdown({
			tableToMarkdown,
			codeSpanOnOneLine,
		});

		htmlToMarkdown(
			"<table><tr><td><span>weekly<td><span>yearly</span></td></span></td></tr><tr><td>1%</td><td>1.7x</td></tr></table>",
		);

		expect(tables.map((table) => table.rows)).toEqual([
			[
				["weekly", "yearly"],
				["1%", "1.7x"],
			],
		]);
	});

	it("hands tableToMarkdown the caption and the content outside any cell apart from the rows", () => {
		const { tables, tableToMarkdown } = recordingTableToMarkdown(() => "");
		const htmlToMarkdown = initHtmlToMarkdown({
			tableToMarkdown,
			codeSpanOnOneLine,
		});

		htmlToMarkdown(
			'<table>Prices as of <a href="/changelog">2026</a><caption>Our <em>plans</em></caption><thead><tr><th>Plan</th></tr></thead><tbody><tr><td>Readplace</td></tr></tbody></table>',
		);

		expect(tables).toEqual([
			{
				outsideCells: "Prices as of [2026](/changelog)",
				caption: "Our _plans_",
				rows: [["Plan"], ["Readplace"]],
			},
		]);
	});

	it("writes what codeSpanOnOneLine returns inside the backticks of inline code, and leaves a code block to the library", () => {
		const contents: string[] = [];
		const htmlToMarkdown = initHtmlToMarkdown({
			tableToMarkdown: () => "",
			codeSpanOnOneLine: (content) => {
				contents.push(content);
				return "SPAN";
			},
		});

		const markdown = htmlToMarkdown(
			"<p><code><span>+</span><p>total</p></code></p><pre><code>npm install</code></pre>",
		);

		expect(contents).toEqual(["+\n\ntotal\n\n"]);
		expect(markdown).toBe("`SPAN`\n\n```\nnpm install\n```");
	});

	it("writes nothing for inline code that codeSpanOnOneLine leaves empty", () => {
		const htmlToMarkdown = initHtmlToMarkdown({
			tableToMarkdown: () => "",
			codeSpanOnOneLine: () => "",
		});

		const markdown = htmlToMarkdown("<p>Run: <code>npm install</code></p>");

		expect(markdown).toBe("Run:");
	});
});
