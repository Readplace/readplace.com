import assert from "node:assert";
import { parseHTML } from "linkedom";

export interface OutlineEntry {
	anchorId: string;
	label: string;
	children: readonly OutlineEntry[];
}

const INVISIBLE_CHARACTERS = /[\u200B\uFEFF]/g;
const PERMALINK_GLYPHS = new Set(["#", "¶", "§", "🔗"]);
const TEXT_NODE = 3;

function visibleTextOf(text: string): string {
	return text.replace(INVISIBLE_CHARACTERS, "").replace(/\s+/g, " ").trim();
}

function isPermalinkAnchor(anchor: Element): boolean {
	const glyph = visibleTextOf(String(anchor.textContent)).replace(/\s/g, "");
	return glyph === "" || PERMALINK_GLYPHS.has(glyph);
}

function labelOf(heading: Element): string {
	const permalinks = new Set<Node>(Array.from(heading.querySelectorAll('a[href^="#"]')).filter(isPermalinkAnchor));
	const read = (node: Node): string => {
		if (permalinks.has(node)) return "";
		if (node.nodeName === "BR") return " ";
		if (node.nodeType === TEXT_NODE) return String(node.nodeValue);
		return Array.from(node.childNodes, read).join("");
	};
	return visibleTextOf(read(heading));
}

function comparable(text: string): string {
	return visibleTextOf(text.normalize("NFKC")).toLowerCase();
}

function onlyWhitespaceTextPrecedes(input: { root: Node; target: Node }): boolean {
	let reached = false;
	let blank = true;
	const visit = (node: Node): void => {
		if (reached) return;
		if (node === input.target) {
			reached = true;
			return;
		}
		if (node.nodeType === TEXT_NODE && visibleTextOf(String(node.nodeValue)) !== "") blank = false;
		for (const child of Array.from(node.childNodes)) visit(child);
	};
	visit(input.root);
	return blank;
}

export function buildArticleOutline(input: { html: string; title: string | undefined }): readonly OutlineEntry[] {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="reader-outline-root">${input.html}</div></body></html>`,
	);
	const root = document.querySelector("div#reader-outline-root");
	assert(root, "parseHTML must produce the reader-outline wrapper div");
	const title = input.title === undefined ? undefined : comparable(input.title);
	const entries: OutlineEntry[] = [];
	let parent: { children: OutlineEntry[] } | undefined;
	let seenLabel = false;
	for (const heading of Array.from(root.querySelectorAll("h2, h3"))) {
		const isSection = heading.nodeName === "H2";
		const label = labelOf(heading);
		const isFirstLabel = label !== "" && !seenLabel;
		if (label !== "") seenLabel = true;
		const repeatsTitle =
			isFirstLabel && comparable(label) === title && onlyWhitespaceTextPrecedes({ root, target: heading });
		if (label === "" || repeatsTitle) {
			if (isSection) parent = undefined;
			continue;
		}
		const anchorId = heading.getAttribute("id");
		assert(anchorId, "every heading with a label carries a minted section id");
		const entry: { anchorId: string; label: string; children: OutlineEntry[] } = { anchorId, label, children: [] };
		if (isSection) {
			entries.push(entry);
			parent = entry;
		} else if (parent) {
			parent.children.push(entry);
		} else {
			entries.push(entry);
		}
	}
	return entries;
}
