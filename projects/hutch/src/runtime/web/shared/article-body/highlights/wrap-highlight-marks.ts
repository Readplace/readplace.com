import type { NormalisedText, TextChunk, TextRange } from "@packages/domain/article/highlight";
import {
	ARTICLE_HIGHLIGHT_CLASS,
	ARTICLE_HIGHLIGHT_HAS_NOTE_CLASS,
	ARTICLE_HIGHLIGHT_NOTE_END_CLASS,
} from "./article-highlight-class";

export interface MarkableHighlight<Id extends string> {
	highlightId: Id;
	note?: string;
	place: TextRange | undefined;
}

interface Piece<Id extends string> {
	highlightId: Id;
	start: number;
	end: number;
}

function piecesByChunk<Id extends string>(input: {
	highlights: readonly MarkableHighlight<Id>[];
	spans: NormalisedText["spans"];
}): Map<number, Piece<Id>[]> {
	const byChunk = new Map<number, Piece<Id>[]>();
	for (const { highlightId, place } of input.highlights) {
		if (place === undefined) continue;
		for (const span of input.spans.slice(place.start, place.end)) {
			if (span.start === span.end) continue;
			const pieces = byChunk.get(span.chunk) ?? [];
			byChunk.set(span.chunk, pieces);
			const piece = pieces.find((candidate) => candidate.highlightId === highlightId);
			if (piece === undefined) {
				pieces.push({ highlightId, start: span.start, end: span.end });
				continue;
			}
			piece.start = Math.min(piece.start, span.start);
			piece.end = Math.max(piece.end, span.end);
		}
	}
	return byChunk;
}

function wrapPieces<Id extends string>(input: {
	document: Document;
	node: ChildNode;
	pieces: readonly Piece<Id>[];
	minted: Set<Id>;
	idPrefix: string;
}): void {
	const { document, node, pieces, minted } = input;
	const segments: Node[] = [];
	const text = String(node.nodeValue);
	const boundaries = [...new Set([0, text.length, ...pieces.flatMap((piece) => [piece.start, piece.end])])].sort(
		(a, b) => a - b,
	);
	for (const [index, start] of boundaries.slice(0, -1).entries()) {
		const end = boundaries[index + 1];
		let segment: Node = document.createTextNode(text.slice(start, end));
		for (const piece of pieces.filter((candidate) => candidate.start <= start && candidate.end >= end).reverse()) {
			const mark = document.createElement("mark");
			mark.setAttribute("class", ARTICLE_HIGHLIGHT_CLASS);
			mark.setAttribute("data-highlight-id", piece.highlightId);
			if (!minted.has(piece.highlightId)) {
				minted.add(piece.highlightId);
				mark.setAttribute("id", `${input.idPrefix}${piece.highlightId}`);
			}
			mark.appendChild(segment);
			segment = mark;
		}
		segments.push(segment);
	}
	node.replaceWith(...segments);
}

function markNotedHighlights<Id extends string>(input: {
	root: Element;
	highlights: readonly MarkableHighlight<Id>[];
}): ReadonlySet<Id> {
	const noted = new Map(
		input.highlights
			.filter((highlight) => highlight.note !== undefined)
			.map((highlight) => [String(highlight.highlightId), highlight.highlightId]),
	);
	const lastSegments = new Map<Id, Element>();
	for (const mark of Array.from(input.root.querySelectorAll("mark[data-highlight-id]"))) {
		const highlightId = noted.get(String(mark.getAttribute("data-highlight-id")));
		if (highlightId === undefined) continue;
		mark.classList.add(ARTICLE_HIGHLIGHT_HAS_NOTE_CLASS);
		lastSegments.set(highlightId, mark);
	}
	for (const mark of lastSegments.values()) {
		mark.classList.add(ARTICLE_HIGHLIGHT_NOTE_END_CLASS);
	}
	return new Set(lastSegments.keys());
}

export function wrapHighlightMarks<Id extends string>(input: {
	document: Document;
	root: Element;
	chunks: readonly TextChunk<ChildNode>[];
	spans: NormalisedText["spans"];
	highlights: readonly MarkableHighlight<Id>[];
	idPrefix: string;
}): ReadonlySet<Id> {
	const minted = new Set<Id>();
	const byChunk = [...piecesByChunk({ highlights: input.highlights, spans: input.spans })].sort(([a], [b]) => a - b);
	for (const [chunk, pieces] of byChunk) {
		wrapPieces({ document: input.document, node: input.chunks[chunk].node, pieces, minted, idPrefix: input.idPrefix });
	}
	return markNotedHighlights({ root: input.root, highlights: input.highlights });
}
