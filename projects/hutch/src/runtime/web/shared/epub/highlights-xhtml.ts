import type { ReaderHighlightState } from "../article-body/reader-slot/mark-highlights";
import { escapeXmlText } from "./epub-xhtml";

const ORPHAN_SUFFIX = " (not found in the current version)";

function paragraph(text: string): string {
	return `<p>${escapeXmlText(text)}</p>`;
}

function entryXhtml(state: ReaderHighlightState): string {
	const blocks = state.highlight.exact.split("\n");
	const suffix = state.anchor.anchorState === "orphaned" ? ORPHAN_SUFFIX : "";
	const quoted = blocks.map((block, index) => paragraph(index === blocks.length - 1 ? block + suffix : block)).join("");
	const note = state.highlight.note === undefined ? "" : paragraph(state.highlight.note);
	return `<blockquote>${quoted}</blockquote>${note}`;
}

export function highlightsXhtml(states: readonly ReaderHighlightState[]): string {
	if (states.length === 0) return "";
	const entries = [...states].sort((a, b) => a.highlight.orderKey - b.highlight.orderKey).map(entryXhtml);
	return `<h2>Highlights</h2>${entries.join("")}`;
}
