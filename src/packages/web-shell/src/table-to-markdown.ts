import type { TableToMarkdown } from "./markdown-conversion";

type Rows = readonly (readonly string[])[];

const LINE_BREAK = / {2}\n/g;

export const tableToMarkdown: TableToMarkdown = (table) => {
	const rows = table.rows.filter((row) => row.some((cell) => cell !== ""));
	const blocks =
		rows.length > 1 && rows.every((row) => row.every(fitsOnOneLine))
			? [gfmTable(rows)]
			: rows.flat();
	return [table.outsideCells, table.caption, ...blocks]
		.filter((block) => block !== "")
		.join("\n\n");
};

function fitsOnOneLine(cell: string): boolean {
	return !cell.replace(LINE_BREAK, "").includes("\n");
}

function gfmTable(rows: Rows): string {
	const columns = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
	const [header, ...body] = rows;
	return [
		gfmRow([...header, ...Array<string>(columns - header.length).fill("")]),
		`|${" --- |".repeat(columns)}`,
		...body.map(gfmRow),
	].join("\n");
}

function gfmRow(cells: readonly string[]): string {
	return `| ${cells.map((cell) => cell.replace(LINE_BREAK, "<br>").replaceAll("|", "\\|")).join(" | ")} |`;
}
