import assert from "node:assert";
import type { HighlightId } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import type { ReaderHighlightState } from "../article-body/reader-slot/mark-highlights";
import { escapeXmlAttribute, escapeXmlText } from "./epub-xhtml";

export const ORPHAN_SUFFIX = " (not found in the current version)";

const NOTE_REFERENCE_ID_PREFIX = "noteref-highlight-";
const NOTE_ID_PREFIX = "endnote-highlight-";

function paragraph(text: string): string {
	return `<p>${escapeXmlText(text)}</p>`;
}

function numberedNote(input: { state: ReaderHighlightState; note: string; number: number }): string {
	const id = input.state.highlight.highlightId;
	return `<p id="${escapeXmlAttribute(`${NOTE_ID_PREFIX}${id}`)}"><a role="doc-backlink" href="${escapeXmlAttribute(`#${NOTE_REFERENCE_ID_PREFIX}${id}`)}">${input.number}</a> ${escapeXmlText(input.note)}</p>`;
}

function entryXhtml(entry: { state: ReaderHighlightState; number?: number }): string {
	const { highlight, anchor } = entry.state;
	const blocks = highlight.exact.split("\n");
	const suffix = anchor.anchorState === "orphaned" ? ORPHAN_SUFFIX : "";
	const quoted = blocks.map((block, index) => paragraph(index === blocks.length - 1 ? block + suffix : block)).join("");
	if (highlight.note === undefined) return `<blockquote>${quoted}</blockquote>`;
	const note =
		entry.number === undefined
			? paragraph(highlight.note)
			: numberedNote({ state: entry.state, note: highlight.note, number: entry.number });
	return `<blockquote>${quoted}</blockquote>${note}`;
}

function inOrder(states: readonly ReaderHighlightState[]): ReaderHighlightState[] {
	return [...states].sort((a, b) => a.highlight.orderKey - b.highlight.orderKey);
}

function sectionXhtml(entries: readonly string[]): string {
	if (entries.length === 0) return "";
	return `<h2>Highlights</h2>${entries.join("")}`;
}

export function highlightsXhtml(states: readonly ReaderHighlightState[]): string {
	return sectionXhtml(inOrder(states).map((state) => entryXhtml({ state })));
}

function outermostLinkHolding(input: { element: Element; root: Element }): Element {
	let holder = input.element;
	for (let parent = input.element.parentElement; parent !== input.root; parent = parent.parentElement) {
		assert(parent, "a note-end mark always sits inside the chapter root");
		if (parent.localName === "a") holder = parent;
	}
	return holder;
}

export function noteReferencedChapterXhtml(input: {
	html: string;
	states: readonly ReaderHighlightState[];
	noteEnds: ReadonlySet<HighlightId>;
}): {
	bodyHtml: string;
	highlightsHtml: string;
} {
	const { document } = parseHTML(`<!DOCTYPE html><html><body><div id="epub-chapter-root">${input.html}</div></body></html>`);
	const root = document.querySelector("div#epub-chapter-root");
	assert(root, "parseHTML must produce the chapter wrapper div");
	const numbers = new Map<string, number>();
	for (const { highlight } of inOrder(input.states)) {
		if (input.noteEnds.has(highlight.highlightId)) numbers.set(highlight.highlightId, numbers.size + 1);
	}
	const marks = Array.from(root.querySelectorAll("mark[data-highlight-id]"));
	const lastSegments = new Map<string, Element>();
	for (const mark of marks) lastSegments.set(String(mark.getAttribute("data-highlight-id")), mark);
	assert(
		[...numbers.keys()].every((highlightId) => lastSegments.has(highlightId)),
		"every noted highlight's end mark is in the chapter",
	);
	const references = new Set<Node>();
	for (const mark of marks) {
		const highlightId = String(mark.getAttribute("data-highlight-id"));
		const number = numbers.get(highlightId);
		if (number === undefined || lastSegments.get(highlightId) !== mark) continue;
		const link = document.createElement("a");
		link.setAttribute("epub:type", "noteref");
		link.setAttribute("role", "doc-noteref");
		link.setAttribute("id", `${NOTE_REFERENCE_ID_PREFIX}${highlightId}`);
		link.setAttribute("href", `#${NOTE_ID_PREFIX}${highlightId}`);
		link.textContent = String(number);
		const reference = document.createElement("sup");
		reference.appendChild(link);
		let before: Node = outermostLinkHolding({ element: mark, root });
		while (before.nextSibling !== null && references.has(before.nextSibling)) before = before.nextSibling;
		const parent = before.parentNode;
		assert(parent, "a note-end mark always sits inside the chapter root");
		parent.insertBefore(reference, before.nextSibling);
		references.add(reference);
	}
	return {
		bodyHtml: root.innerHTML,
		highlightsHtml: sectionXhtml(
			inOrder(input.states).map((state) => entryXhtml({ state, number: numbers.get(state.highlight.highlightId) })),
		),
	};
}
