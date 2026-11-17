import { sentenceBoundsAt } from "./sentence-bounds";
import type { TextRange } from "./text-anchoring";

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function cutOffset(params: { text: string; start: number; limit: number }): number {
	const window = params.text.slice(params.start, params.limit);
	const lastBlockBoundary = window.lastIndexOf("\n");
	if (lastBlockBoundary > 0) return params.start + lastBlockBoundary + 1;
	const lastSentence = sentenceBoundsAt({ text: window, offset: window.length - 1 });
	if (lastSentence !== undefined && lastSentence.start > 0) return params.start + lastSentence.start;
	const lastWhitespace = window.search(/\s\S*$/);
	if (lastWhitespace > 0) return params.start + lastWhitespace + 1;
	return isHighSurrogate(params.text.charCodeAt(params.limit - 1)) ? params.limit - 1 : params.limit;
}

export function cutRange(params: { text: string; range: TextRange; maxLength: number }): TextRange[] {
	const pieces: TextRange[] = [];
	let start = params.range.start;
	while (params.range.end - start > params.maxLength) {
		const end = cutOffset({ text: params.text, start, limit: start + params.maxLength });
		pieces.push({ start, end });
		start = end;
	}
	pieces.push({ start, end: params.range.end });
	return pieces;
}
