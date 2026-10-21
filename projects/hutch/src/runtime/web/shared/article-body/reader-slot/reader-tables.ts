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
const ROW_GROUP_TAGS = new Set(["THEAD", "TBODY", "TFOOT"]);

interface TableRow {
	row: Element;
	inHead: boolean;
}

interface PlacedCell {
	cell: Element;
	row: number;
	column: number;
	columnSpan: number;
	rowSpan: number;
}

interface Heading {
	placed: PlacedCell;
	text: string;
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

function placeCells(rows: readonly TableRow[]): PlacedCell[] {
	const occupiedUntilRow: number[] = [];
	const placed: PlacedCell[] = [];
	for (const [rowIndex, { row }] of rows.entries()) {
		let column = 0;
		for (const cell of cellsOf(row)) {
			while ((occupiedUntilRow[column] ?? 0) > rowIndex) column++;
			const columnSpan = spanOf({ cell, attribute: "colspan" });
			const rowSpan = spanOf({ cell, attribute: "rowspan" });
			placed.push({ cell, row: rowIndex, column, columnSpan, rowSpan });
			for (let spanned = column; spanned < column + columnSpan; spanned++) {
				occupiedUntilRow[spanned] = Math.max(occupiedUntilRow[spanned] ?? 0, rowIndex + rowSpan);
			}
			column += columnSpan;
		}
	}
	return placed;
}

function textOf(element: Element): string {
	return String(element.textContent).replace(/\s+/g, " ").trim();
}

function holdsContent(cell: Element): boolean {
	return textOf(cell) !== "" || cell.querySelector("img") !== null;
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

function labelCells(input: { rows: readonly TableRow[]; placed: readonly PlacedCell[] }): void {
	const headerRows = new Set(headerRowIndexes(input.rows));
	const columnCount = input.placed.reduce((count, placed) => Math.max(count, placed.column + placed.columnSpan), 0);
	const headerCells = input.placed.filter((placed) => headerRows.has(placed.row));
	const titleRows = new Set(
		headerCells.filter((placed) => placed.column === 0 && placed.columnSpan >= columnCount).map((placed) => placed.row),
	);
	const headingCells = headerCells.filter((placed) => !titleRows.has(placed.row));
	const headingsByColumn = new Map<number, Heading[]>();
	for (const placed of headingCells) {
		const text = textOf(placed.cell);
		if (text === "") continue;
		for (let column = placed.column; column < placed.column + placed.columnSpan; column++) {
			const headings = headingsByColumn.get(column) ?? [];
			headings.push({ placed, text });
			headingsByColumn.set(column, headings);
		}
	}
	const carried = new Set<PlacedCell>();
	for (const placed of input.placed) {
		if (headerRows.has(placed.row) || !holdsContent(placed.cell)) continue;
		const over = (headingsByColumn.get(placed.column) ?? []).filter(
			(heading) => heading.placed.column + heading.placed.columnSpan >= placed.column + placed.columnSpan,
		);
		if (over.length === 0) continue;
		placed.cell.setAttribute(READER_CELL_LABEL_ATTRIBUTE, over.map((heading) => heading.text).join(LABEL_SEPARATOR));
		for (const heading of over) carried.add(heading.placed);
	}
	if (!headingCells.every((placed) => carried.has(placed) || !holdsContent(placed.cell))) return;
	for (const [index, { row }] of input.rows.entries()) {
		if (headerRows.has(index) && !titleRows.has(index)) row.setAttribute(READER_HEADER_ROW_ATTRIBUTE, "");
	}
}

function cellNeedPx(cell: Element): number {
	const preformatted = cell.querySelector("pre") !== null;
	const glyphPx =
		preformatted || cell.querySelector("code, kbd, samp") !== null
			? GLYPH_PX.code
			: cell.tagName === "TH"
				? GLYPH_PX.header
				: GLYPH_PX.plain;
	const longestRun = String(cell.textContent)
		.split(preformatted ? /\n/ : /[ \t\n\r\f]+/)
		.reduce((longest, run) => Math.max(longest, run.length), 0);
	const listIndentPx = cell.querySelector("ul, ol") === null ? 0 : LIST_INDENT_PX;
	return longestRun * glyphPx + listIndentPx + (preformatted ? PRE_PADDING_PX : 0);
}

function estimatedWidthPx(input: { placed: readonly PlacedCell[]; caption: Element | undefined }): number {
	const columnNeedPx = new Map<number, number>();
	for (const placed of input.placed) {
		if (placed.columnSpan !== 1) continue;
		columnNeedPx.set(placed.column, Math.max(columnNeedPx.get(placed.column) ?? 0, cellNeedPx(placed.cell)));
	}
	for (const placed of input.placed) {
		if (placed.columnSpan === 1) continue;
		const spanned = Array.from({ length: placed.columnSpan }, (_, offset) => placed.column + offset).flatMap(
			(column) => {
				const needPx = columnNeedPx.get(column);
				return needPx === undefined ? [] : [{ column, needPx }];
			},
		);
		const havePx =
			spanned.reduce((sum, entry) => sum + entry.needPx, 0) + Math.max(0, spanned.length - 1) * CELL_PADDING_PX;
		const shortfallPx = cellNeedPx(placed.cell) - havePx;
		if (shortfallPx <= 0) continue;
		const widened = spanned.at(-1) ?? { column: placed.column, needPx: 0 };
		columnNeedPx.set(widened.column, widened.needPx + shortfallPx);
	}
	const tablePx = Array.from(columnNeedPx.values()).reduce(
		(sum, needPx) => sum + needPx + CELL_PADDING_PX,
		TABLE_BORDER_PX,
	);
	return input.caption === undefined ? tablePx : Math.max(tablePx, cellNeedPx(input.caption) + TABLE_BORDER_PX);
}

function describeTable(table: Element): void {
	const rows = ownRows(table);
	if (rows.every(({ row }) => cellsOf(row).length <= 1)) {
		table.setAttribute(READER_TABLE_FLOW_ATTRIBUTE, "");
		return;
	}
	const placed = placeCells(rows);
	labelCells({ rows, placed });
	const caption = Array.from(table.children).find((child) => child.tagName === "CAPTION");
	if (estimatedWidthPx({ placed, caption }) <= GRID_COLUMN_PX) table.setAttribute(READER_TABLE_FITS_ATTRIBUTE, "");
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
	for (const table of Array.from(root.querySelectorAll("table"))) describeTable(table);
	return root.innerHTML;
}
