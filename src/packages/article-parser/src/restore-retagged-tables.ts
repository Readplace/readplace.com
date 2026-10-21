import assert from "node:assert";
import { parseHTML } from "linkedom";
import { retagToDiv } from "./promote-br-paragraph-hosts";

const TABLE_PART_TAGS = new Set(["CAPTION", "COLGROUP", "COL", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH"]);
const ROW_GROUP_TAGS = new Set(["THEAD", "TBODY", "TFOOT"]);
const CELL_TAGS = new Set(["TD", "TH"]);
const TABLE_PART_SELECTOR = [...TABLE_PART_TAGS].join(",").toLowerCase();

export function restoreRetaggedTables(html: string): string {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const root = document.getElementById("root");
	assert(root, "Root element must exist");

	const runs = findOrphanRuns(root);
	if (runs.length === 0) return html;

	for (const run of runs.reverse()) {
		if (formsGrid(run)) wrapInTable({ run, document });
		else retagToBlocks({ run, document });
	}
	return root.innerHTML;
}

function findOrphanRuns(root: Element): Element[][] {
	const runs: Element[][] = [];
	for (const part of Array.from(root.querySelectorAll(TABLE_PART_SELECTOR))) {
		if (part.closest("table")) continue;
		const parent = part.parentElement;
		assert(parent, "a table part selected under the root always has a parent element");
		if (TABLE_PART_TAGS.has(parent.tagName)) continue;
		if (isTablePart(part.previousElementSibling)) continue;
		runs.push(partsFrom(part));
	}
	return runs;
}

function partsFrom(first: Element): Element[] {
	const run = [first];
	for (let next = first.nextElementSibling; isTablePart(next); next = next.nextElementSibling) run.push(next);
	return run;
}

function isTablePart(element: Element | null): element is Element {
	return element !== null && TABLE_PART_TAGS.has(element.tagName);
}

function formsGrid(run: Element[]): boolean {
	const rows = run.flatMap(rowsOf);
	return rows.length >= 2 && rows.some((row) => Array.from(row.children).filter((child) => CELL_TAGS.has(child.tagName)).length >= 2);
}

function rowsOf(part: Element): Element[] {
	if (part.tagName === "TR") return [part];
	if (!ROW_GROUP_TAGS.has(part.tagName)) return [];
	return Array.from(part.children).filter((child) => child.tagName === "TR");
}

function wrapInTable(params: { run: Element[]; document: Document }): void {
	const { run, document } = params;
	const [first] = run;
	const last = run[run.length - 1];
	const nodes: ChildNode[] = [first];
	while (nodes[nodes.length - 1] !== last) {
		const next = nodes[nodes.length - 1].nextSibling;
		assert(next, "the last part of a run is a later sibling of its first part");
		nodes.push(next);
	}
	const table = document.createElement("table");
	first.before(table);
	table.append(...nodes);
}

function retagToBlocks(params: { run: Element[]; document: Document }): void {
	const parts = params.run
		.flatMap((member) => [member, ...Array.from(member.querySelectorAll(TABLE_PART_SELECTOR))])
		.filter((part) => part.closest("table") === null);
	for (const element of parts) retagToDiv({ element, document: params.document });
}
