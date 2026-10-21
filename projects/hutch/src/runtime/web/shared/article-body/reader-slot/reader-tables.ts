import assert from "node:assert";
import { parseHTML } from "linkedom";
import {
	READER_CELL_LABEL_ATTRIBUTE,
	READER_HEADER_ROW_ATTRIBUTE,
	READER_TABLE_FITS_ATTRIBUTE,
	READER_TABLE_FLOW_ATTRIBUTE,
} from "@packages/domain/article";

const GRID_COLUMN_PX = 600;
const CELL_PADDING_PX = 32;
const TABLE_BORDER_PX = 2;
const LIST_INDENT_PX = 24;
const PRE_PADDING_PX = 32;
const MAX_SPAN = 1000;
const GLYPH_PX = { plain: 10.5, header: 11, code: 9 } as const;
const LABEL_SEPARATOR = " · ";
const LABEL_HTML_PER_BODY_CHARACTER = 3;
const WORK_PER_BODY_CHARACTER = 2;
const LABEL_ATTRIBUTE = ` ${READER_CELL_LABEL_ATTRIBUTE}=""`;
const ESCAPED_IN_ATTRIBUTE = /["&<>]/;
const LONGEST_ATTRIBUTE_ESCAPE = "&quot;";
const ROW_GROUP_TAGS = new Set(["THEAD", "TBODY", "TFOOT"]);
const CODE_TAGS = ["CODE", "KBD", "SAMP"];
const LIST_TAGS = ["UL", "OL"];
const TEXT_NODE = 3;

interface Budget {
	labelHtml: number;
	work: number;
}

interface TableRow {
	row: Element;
	inHead: boolean;
}

interface CellContent {
	text: string;
	holdsContent: boolean;
	needPx: number;
	readWork: number;
}

interface PlacedCell {
	cell: Element;
	content: CellContent;
	row: number;
	column: number;
	columnSpan: number;
	rowSpan: number;
}

interface Heading {
	placed: PlacedCell;
	htmlLength: number;
}

interface Label {
	placed: PlacedCell;
	over: readonly Heading[];
}

function ownRows(table: Element): TableRow[] {
	return Array.from(table.children).flatMap((child) => {
		if (child.tagName === "TR") return [{ row: child, inHead: false }];
		if (!ROW_GROUP_TAGS.has(child.tagName)) return [];
		return Array.from(child.children)
			.filter((row) => row.tagName === "TR")
			.map((row) => ({ row, inHead: child.tagName === "THEAD" }));
	});
}

function cellsOf(row: Element): Element[] {
	return Array.from(row.children).filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
}

function spanOf(input: { cell: Element; attribute: "colspan" | "rowspan" }): number {
	const span = Number.parseInt(input.cell.getAttribute(input.attribute) ?? "1", 10);
	return span >= 1 ? Math.min(span, MAX_SPAN) : 1;
}

function spend(input: { budget: Budget; work: number }): boolean {
	input.budget.work -= input.work;
	return input.budget.work >= 0;
}

function gridWork(input: { rows: readonly TableRow[]; headerRows: ReadonlySet<number> }): number {
	let work = 0;
	for (const [index, { row }] of input.rows.entries()) {
		const lookups = input.headerRows.has(index) ? 0 : input.headerRows.size;
		for (const cell of cellsOf(row)) {
			const rowSpan = Math.min(spanOf({ cell, attribute: "rowspan" }), input.rows.length - index);
			work += spanOf({ cell, attribute: "colspan" }) * rowSpan + lookups;
		}
	}
	return work;
}

function needPx(input: { element: Element; text: string; tags: ReadonlySet<string> }): number {
	const preformatted = input.tags.has("PRE");
	const glyphPx =
		preformatted || CODE_TAGS.some((tag) => input.tags.has(tag))
			? GLYPH_PX.code
			: input.element.tagName === "TH"
				? GLYPH_PX.header
				: GLYPH_PX.plain;
	const longestRun = input.text
		.split(preformatted ? /\n/ : /[ \t\n\r\f]+/)
		.reduce((longest, run) => Math.max(longest, run.length), 0);
	const listIndentPx = LIST_TAGS.some((tag) => input.tags.has(tag)) ? LIST_INDENT_PX : 0;
	return longestRun * glyphPx + listIndentPx + (preformatted ? PRE_PADDING_PX : 0);
}

function readContent(element: Element): CellContent {
	const walker = element.ownerDocument.createTreeWalker(element);
	const texts: string[] = [];
	const tags = new Set<string>();
	let nodes = 0;
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		nodes++;
		if (node.nodeType === TEXT_NODE) texts.push(String(node.nodeValue));
		else tags.add(node.nodeName);
	}
	const text = texts.join("");
	const collapsed = text.replace(/\s+/g, " ").trim();
	return {
		text: collapsed,
		holdsContent: collapsed !== "" || tags.has("IMG"),
		needPx: needPx({ element, text, tags }),
		readWork: nodes + text.length,
	};
}

function placeCells(rows: readonly TableRow[]): PlacedCell[] {
	const occupiedUntilRow: number[] = [];
	const placed: PlacedCell[] = [];
	for (const [rowIndex, { row }] of rows.entries()) {
		let column = 0;
		for (const cell of cellsOf(row)) {
			while ((occupiedUntilRow[column] ?? 0) > rowIndex) column++;
			const columnSpan = spanOf({ cell, attribute: "colspan" });
			const rowSpan = spanOf({ cell, attribute: "rowspan" });
			placed.push({ cell, content: readContent(cell), row: rowIndex, column, columnSpan, rowSpan });
			if (rowSpan > 1) {
				for (let spanned = column; spanned < column + columnSpan; spanned++) {
					occupiedUntilRow[spanned] = Math.max(occupiedUntilRow[spanned] ?? 0, rowIndex + rowSpan);
				}
			}
			column += columnSpan;
		}
	}
	return placed;
}

function headerRowIndexes(rows: readonly TableRow[]): number[] {
	const headRows = rows.flatMap((entry, index) => (entry.inHead ? [index] : []));
	if (headRows.length > 0) return headRows;
	const allHeaderCells = rows.map(({ row }) => {
		const cells = cellsOf(row);
		return cells.length > 0 && cells.every((cell) => cell.tagName === "TH");
	});
	let leadingRows = 0;
	while (allHeaderCells[leadingRows]) leadingRows++;
	if (allHeaderCells.includes(true, leadingRows)) return [];
	return Array.from({ length: leadingRows }, (_, index) => index);
}

function htmlLengthInAttribute(text: string): number {
	const escapes = text.split(ESCAPED_IN_ATTRIBUTE).length - 1;
	return text.length + escapes * (LONGEST_ATTRIBUTE_ESCAPE.length - 1);
}

function headingOver(input: { headings: readonly Heading[]; placed: PlacedCell }): Heading[] {
	let low = 0;
	let high = input.headings.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (input.headings[middle].placed.column <= input.placed.column) low = middle + 1;
		else high = middle;
	}
	const heading = input.headings[low - 1];
	return heading !== undefined &&
		heading.placed.column + heading.placed.columnSpan >= input.placed.column + input.placed.columnSpan
		? [heading]
		: [];
}

function labelCells(input: {
	rows: readonly TableRow[];
	placed: readonly PlacedCell[];
	headerRows: ReadonlySet<number>;
	budget: Budget;
}): void {
	const columnCount = input.placed.reduce((count, placed) => Math.max(count, placed.column + placed.columnSpan), 0);
	const headerCells = input.placed.filter((placed) => input.headerRows.has(placed.row));
	const titleRows = new Set(
		headerCells.filter((placed) => placed.column === 0 && placed.columnSpan >= columnCount).map((placed) => placed.row),
	);
	const headingCells = headerCells.filter((placed) => !titleRows.has(placed.row));
	const headingsByRow = new Map<number, Heading[]>();
	for (const placed of headingCells) {
		if (placed.content.text === "") continue;
		const headings = headingsByRow.get(placed.row) ?? [];
		headings.push({ placed, htmlLength: htmlLengthInAttribute(placed.content.text) });
		headingsByRow.set(placed.row, headings);
	}
	const headingRows = Array.from(headingsByRow.values());
	const labels: Label[] = [];
	let labelHtml = 0;
	for (const placed of input.placed) {
		if (input.headerRows.has(placed.row) || !placed.content.holdsContent) continue;
		const over = headingRows.flatMap((headings) => headingOver({ headings, placed }));
		if (over.length === 0) continue;
		labelHtml +=
			LABEL_ATTRIBUTE.length +
			LABEL_SEPARATOR.length * (over.length - 1) +
			over.reduce((sum, heading) => sum + heading.htmlLength, 0);
		if (labelHtml > input.budget.labelHtml) return;
		labels.push({ placed, over });
	}
	input.budget.labelHtml -= labelHtml;
	const carried = new Set<PlacedCell>();
	for (const label of labels) {
		label.placed.cell.setAttribute(
			READER_CELL_LABEL_ATTRIBUTE,
			label.over.map((heading) => heading.placed.content.text).join(LABEL_SEPARATOR),
		);
		for (const heading of label.over) carried.add(heading.placed);
	}
	if (!headingCells.every((placed) => carried.has(placed) || !placed.content.holdsContent)) return;
	for (const [index, { row }] of input.rows.entries()) {
		if (input.headerRows.has(index) && !titleRows.has(index)) row.setAttribute(READER_HEADER_ROW_ATTRIBUTE, "");
	}
}

function estimatedWidthPx(input: { placed: readonly PlacedCell[]; caption: CellContent | undefined }): number {
	const columnNeedPx = new Map<number, number>();
	for (const placed of input.placed) {
		if (placed.columnSpan !== 1) continue;
		columnNeedPx.set(placed.column, Math.max(columnNeedPx.get(placed.column) ?? 0, placed.content.needPx));
	}
	for (const placed of input.placed) {
		if (placed.columnSpan === 1) continue;
		const spanned: { column: number; needPx: number }[] = [];
		for (let column = placed.column; column < placed.column + placed.columnSpan; column++) {
			const needPx = columnNeedPx.get(column);
			if (needPx !== undefined) spanned.push({ column, needPx });
		}
		const havePx =
			spanned.reduce((sum, entry) => sum + entry.needPx, 0) + Math.max(0, spanned.length - 1) * CELL_PADDING_PX;
		const shortfallPx = placed.content.needPx - havePx;
		if (shortfallPx <= 0) continue;
		const widened = spanned.at(-1) ?? { column: placed.column, needPx: 0 };
		columnNeedPx.set(widened.column, widened.needPx + shortfallPx);
	}
	const tablePx = Array.from(columnNeedPx.values()).reduce(
		(sum, needPx) => sum + needPx + CELL_PADDING_PX,
		TABLE_BORDER_PX,
	);
	return input.caption === undefined ? tablePx : Math.max(tablePx, input.caption.needPx + TABLE_BORDER_PX);
}

function describeTable(input: { table: Element; budget: Budget }): void {
	const rows = ownRows(input.table);
	if (rows.every(({ row }) => cellsOf(row).length <= 1)) {
		input.table.setAttribute(READER_TABLE_FLOW_ATTRIBUTE, "");
		return;
	}
	const headerRows = new Set(headerRowIndexes(rows));
	if (!spend({ budget: input.budget, work: gridWork({ rows, headerRows }) })) return;
	const placed = placeCells(rows);
	const captionElement = Array.from(input.table.children).find((child) => child.tagName === "CAPTION");
	const caption = captionElement === undefined ? undefined : readContent(captionElement);
	const readWork = placed.reduce((sum, { content }) => sum + content.readWork, caption?.readWork ?? 0);
	if (!spend({ budget: input.budget, work: readWork })) return;
	labelCells({ rows, placed, headerRows, budget: input.budget });
	if (estimatedWidthPx({ placed, caption }) <= GRID_COLUMN_PX) input.table.setAttribute(READER_TABLE_FITS_ATTRIBUTE, "");
}

export function describeReaderTables(html: string): string {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="reader-tables-root">${html}</div></body></html>`,
	);
	const root = document.querySelector("div#reader-tables-root");
	assert(root, "parseHTML must produce the reader-tables wrapper div");
	for (const attribute of [
		READER_CELL_LABEL_ATTRIBUTE,
		READER_HEADER_ROW_ATTRIBUTE,
		READER_TABLE_FITS_ATTRIBUTE,
		READER_TABLE_FLOW_ATTRIBUTE,
	]) {
		for (const element of Array.from(root.querySelectorAll(`[${attribute}]`))) element.removeAttribute(attribute);
	}
	const budget: Budget = {
		labelHtml: LABEL_HTML_PER_BODY_CHARACTER * html.length,
		work: WORK_PER_BODY_CHARACTER * html.length,
	};
	for (const table of Array.from(root.querySelectorAll("table"))) describeTable({ table, budget });
	return root.innerHTML;
}
