import type { AnchorState, TextQuoteSelector } from "./highlight";

export const HIGHLIGHT_CONTEXT_LENGTH = 32;
export const HIGHLIGHT_MAX_EXACT_LENGTH = 8191;
export const FUZZY_MAX_ERROR_RATIO = 0.2;
export const FUZZY_MAX_ERRORS = 256;
export const MIN_SCORE = 0.8;
export const MIN_QUOTE_SIMILARITY = 0.8;
export const MIN_CONTEXT_SIMILARITY = 0.5;
export const MIN_RUNNER_UP_GAP = 0.05;

export interface NormalisableChunk {
	text: string;
	blockBoundaryBefore: boolean;
}

export interface RawSpan {
	chunk: number;
	start: number;
	end: number;
}

export interface NormalisedText {
	text: string;
	spans: readonly RawSpan[];
}

export interface TextRange {
	start: number;
	end: number;
}

const FOLDS: ReadonlyMap<string, string> = new Map([
	["‘", "'"],
	["’", "'"],
	["‚", "'"],
	["‛", "'"],
	["′", "'"],
	["“", '"'],
	["”", '"'],
	["„", '"'],
	["‟", '"'],
	["″", '"'],
	["‐", "-"],
	["‑", "-"],
	["‒", "-"],
	["–", "-"],
	["—", "-"],
	["―", "-"],
	["−", "-"],
]);

const DROPPED: ReadonlySet<string> = new Set([
	"\u00AD",
	"\u200B",
	"\u200C",
	"\u200D",
	"\u2060",
	"\uFEFF",
]);
const WHITESPACE = /^\s$/;
const SEGMENT = /\P{M}\p{M}*|\p{M}+/gsu;

export function normaliseText(
	chunks: readonly NormalisableChunk[],
): NormalisedText {
	let text = "";
	const spans: RawSpan[] = [];
	let pendingSpace: RawSpan | undefined;
	let pendingBreak = false;

	chunks.forEach((chunk, chunkIndex) => {
		if (chunk.blockBoundaryBefore) pendingBreak = true;
		for (const match of chunk.text.matchAll(SEGMENT)) {
			const segment = match[0];
			const start = match.index;
			const end = start + segment.length;
			if (DROPPED.has(segment)) continue;
			if (WHITESPACE.test(segment)) {
				pendingSpace ??= { chunk: chunkIndex, start, end };
				continue;
			}
			if (text.length > 0 && pendingBreak) {
				text += "\n";
				spans.push({ chunk: chunkIndex, start, end: start });
			} else if (text.length > 0 && pendingSpace) {
				text += " ";
				spans.push(pendingSpace);
			}
			pendingBreak = false;
			pendingSpace = undefined;
			const folded = (FOLDS.get(segment) ?? segment).normalize("NFC");
			text += folded;
			for (let i = 0; i < folded.length; i++)
				spans.push({ chunk: chunkIndex, start, end });
		}
	});

	return { text, spans };
}

function cutPrefix(params: { text: string; start: number }): string {
	const from = Math.max(0, params.start - HIGHLIGHT_CONTEXT_LENGTH);
	const window = params.text.slice(from, params.start);
	if (from === 0 || /\s/.test(params.text[from - 1])) return window;
	const firstSpace = window.search(/\s/);
	return firstSpace === -1 ? "" : window.slice(firstSpace + 1);
}

function cutSuffix(params: { text: string; end: number }): string {
	const to = Math.min(
		params.text.length,
		params.end + HIGHLIGHT_CONTEXT_LENGTH,
	);
	const window = params.text.slice(params.end, to);
	if (to === params.text.length || /\s/.test(params.text[to])) return window;
	const lastSpace = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"));
	return lastSpace === -1 ? "" : window.slice(0, lastSpace);
}

export function describeRange(params: {
	text: string;
	start: number;
	end: number;
}): TextQuoteSelector & TextRange {
	return {
		exact: params.text.slice(params.start, params.end),
		prefix: cutPrefix(params),
		suffix: cutSuffix(params),
		start: params.start,
		end: params.end,
	};
}

export interface AnchorableHighlight extends TextQuoteSelector, TextRange {
	anchoredContentHash: string;
}

export interface Anchor extends TextRange {
	anchorState: AnchorState;
}

function sharedSuffixLength(params: {
	stored: string;
	served: string;
}): number {
	let length = 0;
	while (
		length < params.stored.length &&
		length < params.served.length &&
		params.stored[params.stored.length - 1 - length] ===
			params.served[params.served.length - 1 - length]
	) {
		length++;
	}
	return length;
}

function sharedPrefixLength(params: {
	stored: string;
	served: string;
}): number {
	let length = 0;
	while (
		length < params.stored.length &&
		params.stored[length] === params.served[length]
	)
		length++;
	return length;
}

function similarity(params: { shared: number; length: number }): number {
	return params.length === 0 ? 0 : params.shared / params.length;
}

function contextScore(params: {
	text: string;
	highlight: AnchorableHighlight;
	start: number;
}): number {
	const { text, highlight, start } = params;
	const end = start + highlight.exact.length;
	const servedPrefix = text.slice(
		Math.max(0, start - highlight.prefix.length),
		start,
	);
	const servedSuffix = text.slice(end, end + highlight.suffix.length);
	return (
		similarity({
			shared: sharedSuffixLength({
				stored: highlight.prefix,
				served: servedPrefix,
			}),
			length: highlight.prefix.length,
		}) +
		similarity({
			shared: sharedPrefixLength({
				stored: highlight.suffix,
				served: servedSuffix,
			}),
			length: highlight.suffix.length,
		})
	);
}

function occurrencesOf(params: { text: string; exact: string }): number[] {
	const starts: number[] = [];
	let at = params.text.indexOf(params.exact);
	while (at !== -1) {
		starts.push(at);
		at = params.text.indexOf(params.exact, at + 1);
	}
	return starts;
}

export function anchorHighlight(params: {
	text: string;
	contentHash: string;
	highlight: AnchorableHighlight;
}): Anchor {
	const { text, contentHash, highlight } = params;
	if (
		contentHash === highlight.anchoredContentHash &&
		text.slice(highlight.start, highlight.end) === highlight.exact
	) {
		return {
			start: highlight.start,
			end: highlight.end,
			anchorState: "anchored",
		};
	}

	const candidates = occurrencesOf({ text, exact: highlight.exact }).map(
		(start) => ({
			start,
			score: contextScore({ text, highlight, start }),
			distance: Math.abs(start - highlight.start),
		}),
	);
	if (candidates.length === 0) {
		return {
			start: highlight.start,
			end: highlight.end,
			anchorState: "orphaned",
		};
	}

	const [best] = candidates.sort(
		(a, b) => b.score - a.score || a.distance - b.distance,
	);
	return {
		start: best.start,
		end: best.start + highlight.exact.length,
		anchorState: best.start === highlight.start ? "anchored" : "moved",
	};
}

export function mergeRanges<R extends TextRange>(params: {
	range: TextRange;
	existing: readonly R[];
}): {
	range: TextRange;
	merged: R[];
} {
	let range = params.range;
	const merged: R[] = [];
	let remaining = [...params.existing];
	let grew = true;
	while (grew) {
		grew = false;
		const next: R[] = [];
		for (const other of remaining) {
			if (other.start <= range.end && other.end >= range.start) {
				range = {
					start: Math.min(range.start, other.start),
					end: Math.max(range.end, other.end),
				};
				merged.push(other);
				grew = true;
			} else {
				next.push(other);
			}
		}
		remaining = next;
	}
	return { range, merged };
}
