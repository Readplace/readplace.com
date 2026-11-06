import assert from "node:assert";
import {
	ARTICLE_HIGHLIGHT_ID_PREFIX,
	type Highlight,
	type HighlightId,
} from "@packages/domain/article";
import {
	type Anchor,
	anchorHighlight,
	collectTextChunks,
	normaliseText,
} from "@packages/domain/article/highlight";
import { parseHTML } from "linkedom";
import { ARTICLE_HIGHLIGHT_CLASS } from "../highlights/highlight-toolbar.component";
import { servedContentHash } from "./served-content-hash";

export interface ReaderHighlights {
	rows: readonly Highlight[];
	canonicalContentHash: string | undefined;
}

export interface ReaderHighlightState {
	highlight: Highlight;
	anchor: Anchor;
}

interface MarkedHighlights {
	html: string;
	text: string;
	states: readonly ReaderHighlightState[];
}

interface Piece {
	highlightId: HighlightId;
	start: number;
	end: number;
}

function piecesByChunk(input: {
	states: readonly ReaderHighlightState[];
	spans: ReturnType<typeof normaliseText>["spans"];
}): Map<number, Piece[]> {
	const byChunk = new Map<number, Piece[]>();
	for (const { highlight, anchor } of input.states) {
		if (anchor.anchorState === "orphaned") continue;
		for (const span of input.spans.slice(anchor.start, anchor.end)) {
			if (span.start === span.end) continue;
			const pieces = byChunk.get(span.chunk) ?? [];
			byChunk.set(span.chunk, pieces);
			const piece = pieces.find(
				(candidate) => candidate.highlightId === highlight.highlightId,
			);
			if (piece === undefined) {
				pieces.push({
					highlightId: highlight.highlightId,
					start: span.start,
					end: span.end,
				});
				continue;
			}
			piece.start = Math.min(piece.start, span.start);
			piece.end = Math.max(piece.end, span.end);
		}
	}
	return byChunk;
}

function wrapPieces(input: {
	document: Document;
	node: Node;
	pieces: readonly Piece[];
	minted: Set<HighlightId>;
}): void {
	const { document, node, pieces, minted } = input;
	const parent = node.parentNode;
	assert(parent, "a text chunk always sits inside the marked root");
	const text = String(node.nodeValue);
	const boundaries = [
		...new Set([
			0,
			text.length,
			...pieces.flatMap((piece) => [piece.start, piece.end]),
		]),
	].sort((a, b) => a - b);
	for (const [index, start] of boundaries.slice(0, -1).entries()) {
		const end = boundaries[index + 1];
		let segment: Node = document.createTextNode(text.slice(start, end));
		for (const piece of pieces
			.filter((candidate) => candidate.start <= start && candidate.end >= end)
			.reverse()) {
			const mark = document.createElement("mark");
			mark.setAttribute("class", ARTICLE_HIGHLIGHT_CLASS);
			mark.setAttribute("data-highlight-id", piece.highlightId);
			if (!minted.has(piece.highlightId)) {
				minted.add(piece.highlightId);
				mark.setAttribute(
					"id",
					`${ARTICLE_HIGHLIGHT_ID_PREFIX}${piece.highlightId}`,
				);
			}
			mark.appendChild(segment);
			segment = mark;
		}
		parent.insertBefore(segment, node);
	}
	parent.removeChild(node);
}

export function markHighlights(input: {
	html: string;
	highlights: ReaderHighlights;
}): MarkedHighlights {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="reader-highlights-root">${input.html}</div></body></html>`,
	);
	const root = document.querySelector("div#reader-highlights-root");
	assert(root, "parseHTML must produce the reader-highlights wrapper div");
	for (const mark of Array.from(root.querySelectorAll("mark"))) {
		mark.removeAttribute("class");
		mark.removeAttribute("id");
		mark.removeAttribute("data-highlight-id");
	}
	const chunks = collectTextChunks<Node>(root);
	const normalised = normaliseText(chunks);
	const contentHash =
		input.highlights.canonicalContentHash ?? servedContentHash(normalised.text);
	const states = input.highlights.rows.map((highlight) => ({
		highlight,
		anchor: anchorHighlight({ text: normalised.text, contentHash, highlight }),
	}));
	const minted = new Set<HighlightId>();
	const byChunk = [...piecesByChunk({ states, spans: normalised.spans })].sort(
		([a], [b]) => a - b,
	);
	for (const [chunk, pieces] of byChunk) {
		wrapPieces({ document, node: chunks[chunk].node, pieces, minted });
	}
	return { html: root.innerHTML, text: normalised.text, states };
}
