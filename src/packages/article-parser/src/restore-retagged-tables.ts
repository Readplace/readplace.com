import assert from "node:assert";
import { parseHTML } from "linkedom";

const TABLE_CHILD_TAGS = new Set(["CAPTION", "COLGROUP", "COL", "THEAD", "TBODY", "TFOOT", "TR"]);
const CELL_TAGS = new Set(["TD", "TH"]);
const ROW_GROUP_TAGS = new Set(["TBODY"]);
const ROW_TAGS = new Set(["TR"]);
const TABLE_PART_SELECTOR = [...TABLE_CHILD_TAGS, ...CELL_TAGS].join(",").toLowerCase();

export function restoreRetaggedTables(html: string): string {
	const { document } = parseHTML(`<div id="root">${html}</div>`);
	const root = document.getElementById("root");
	assert(root, "Root element must exist");

	const containers = findContainersOfOrphanTableParts(root).filter(holdsOnlyTableParts);
	if (containers.length === 0) return html;

	for (const container of containers.reverse()) {
		restoreContainer({ container, document });
	}
	return root.innerHTML;
}

function findContainersOfOrphanTableParts(root: Element): Element[] {
	const containers = new Set<Element>();
	for (const part of Array.from(root.querySelectorAll(TABLE_PART_SELECTOR))) {
		if (part.closest("table")) continue;
		const parent = part.parentElement;
		assert(parent, "a table part selected under the root always has a parent element");
		if (TABLE_CHILD_TAGS.has(parent.tagName)) continue;
		containers.add(parent);
	}
	return Array.from(containers);
}

function holdsOnlyTableParts(container: Element): boolean {
	const tags = Array.from(container.children, (child) => child.tagName);
	return tags.every((tag) => TABLE_CHILD_TAGS.has(tag)) || tags.every((tag) => CELL_TAGS.has(tag));
}

function restoreContainer(params: { container: Element; document: Document }): void {
	const { container, document } = params;
	const [first] = Array.from(container.children);
	const cell = findSoleCell(container);
	if (cell) {
		first.replaceWith(...Array.from(cell.childNodes));
		return;
	}
	const table = document.createElement("table");
	const holder = CELL_TAGS.has(first.tagName) ? table.appendChild(document.createElement("tr")) : table;
	holder.append(...Array.from(container.childNodes));
	container.append(table);
}

function findSoleCell(container: Element): Element | undefined {
	const rowGroup = soleChild({ element: container, tags: ROW_GROUP_TAGS }) ?? container;
	const row = soleChild({ element: rowGroup, tags: ROW_TAGS }) ?? rowGroup;
	return soleChild({ element: row, tags: CELL_TAGS });
}

function soleChild(params: { element: Element; tags: ReadonlySet<string> }): Element | undefined {
	const children = Array.from(params.element.children);
	return children.length === 1 && params.tags.has(children[0].tagName) ? children[0] : undefined;
}
