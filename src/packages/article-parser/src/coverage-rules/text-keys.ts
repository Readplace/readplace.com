import assert from "node:assert";
import type { Block } from "./content-walk";
import { CJK_WINDOW, WORD_WINDOW } from "./section-thresholds";

export const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const CODE_KEY_MAX_CHARS = 200;

export function normalise(text: string): string {
	return text
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\p{P}\p{S}]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function isCjkScript(normalised: string): boolean {
	const characters = [...normalised.replace(/\s/g, "")];
	const cjk = characters.filter((character) => CJK_CHARACTER.test(character)).length;
	return characters.length > 0 && cjk * 2 >= characters.length;
}

type Token = { start: number; end: number };

function tokenSpans(normalised: string): { spans: readonly Token[]; window: number } {
	const pattern = isCjkScript(normalised) ? /\S/gu : /\S+/g;
	const spans = [...normalised.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
	return { spans, window: isCjkScript(normalised) ? CJK_WINDOW : WORD_WINDOW };
}

export function tokenCount(text: string): number {
	return tokenSpans(normalise(text)).spans.length;
}

export function candidateKeys(text: string): { keys: readonly string[]; fullWindow: boolean } {
	const normalised = normalise(text);
	const { spans, window } = tokenSpans(normalised);
	assert(spans.length > 0, "a candidate key needs at least one token");
	const last = Math.max(spans.length - window, 0);
	const starts = [...new Set([Math.floor(last / 2), last, 0])];
	const keys = starts.map((start) => {
		const end = Math.min(start + window, spans.length) - 1;
		return normalised.slice(spans[start].start, spans[end].end);
	});
	return { keys: [...new Set(keys)], fullWindow: spans.length >= window };
}

export function stream(blocks: readonly Block[]): string {
	return blocks
		.flatMap((block) => (block.kind === "text" ? [normalise(block.text)] : []))
		.filter((run) => run.length > 0)
		.join(" ");
}

export function indexOfKey(params: { stream: string; key: string; from: number }): number {
	if (isCjkScript(params.key)) {
		return params.stream.indexOf(params.key, params.from);
	}
	return ` ${params.stream} `.indexOf(` ${params.key} `, params.from);
}

export function countKey(params: { stream: string; key: string }): number {
	let count = 0;
	let at = indexOfKey({ stream: params.stream, key: params.key, from: 0 });
	while (at >= 0) {
		count += 1;
		at = indexOfKey({ stream: params.stream, key: params.key, from: at + 1 });
	}
	return count;
}

export function codeKey(text: string): string {
	return text.length <= CODE_KEY_MAX_CHARS ? text : `${text.slice(0, CODE_KEY_MAX_CHARS)}|${text.length}`;
}

export function cellTriple(cell: { rowKey: string; header: string; value: string }): string {
	return [cell.rowKey, cell.header, cell.value].map(normalise).join("\u0000");
}
