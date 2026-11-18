import type { TextRange } from "./text-anchoring";
import type { SentenceRange, Tokens, WordIndex } from "./word-index";

interface Region {
	aLow: number;
	aHigh: number;
	bLow: number;
	bHigh: number;
}

type Pair = readonly [number, number];

export interface TextAlignment {
	basis: string;
	text: string;
	basisTokens: Tokens;
	textTokens: Tokens;
	imageOf: number[];
	basisSentences: SentenceRange[];
	textSentences: SentenceRange[];
	basisEnds: number[];
	textEnds: number[];
	pairOf: number[];
	pairedFrom: number[];
	basisWords: number[][];
	textWords: number[][];
	basisCopyKeys: string[];
	textCopyKeys: string[];
	standsAt: number[];
	kept: boolean[];
	best: Map<string, number>;
	clause: Map<string, number>;
}

export function lowerBound(sorted: readonly number[], value: number): number {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (sorted[middle] < value) low = middle + 1;
		else high = middle;
	}
	return low;
}

export function longestChain(pairs: readonly Pair[]): Pair[] {
	const tails: number[] = [];
	const tailAt: number[] = [];
	const previous: number[] = [];
	for (let p = 0; p < pairs.length; p++) {
		const j = pairs[p][1];
		const slot = lowerBound(tails, j);
		tails[slot] = j;
		tailAt[slot] = p;
		previous[p] = slot > 0 ? tailAt[slot - 1] : -1;
	}
	const out: Pair[] = [];
	for (let p = tailAt[tails.length - 1]; p >= 0; p = previous[p])
		out.push(pairs[p]);
	return out.reverse();
}

function onceIn<K>(
	keys: readonly K[],
	low: number,
	high: number,
): Map<K, number> {
	const at = new Map<K, number>();
	for (let i = low; i < high; i++) at.set(keys[i], at.has(keys[i]) ? -1 : i);
	return at;
}

function uniquePairs<K>(params: {
	a: readonly K[];
	b: readonly K[];
	region: Region;
}): Pair[] {
	const { a, b, region } = params;
	const inA = onceIn(a, region.aLow, region.aHigh);
	const inB = onceIn(b, region.bLow, region.bHigh);
	const pairs: Pair[] = [];
	for (let i = region.aLow; i < region.aHigh; i++) {
		const j = inB.get(a[i]);
		if (inA.get(a[i]) === i && j !== undefined && j >= 0) pairs.push([i, j]);
	}
	return pairs;
}

function runKeys(keys: readonly number[], low: number, high: number): string[] {
	const out: string[] = [];
	for (let i = low; i + 1 < high; i++) out.push(`${keys[i]},${keys[i + 1]}`);
	return out;
}

function uniqueRunPairs(params: {
	a: readonly number[];
	b: readonly number[];
	region: Region;
}): Pair[] {
	const { a, b, region } = params;
	const runsA = runKeys(a, region.aLow, region.aHigh);
	const runsB = runKeys(b, region.bLow, region.bHigh);
	return uniquePairs({
		a: runsA,
		b: runsB,
		region: { aLow: 0, aHigh: runsA.length, bLow: 0, bHigh: runsB.length },
	}).map(([i, j]) => [i + region.aLow, j + region.bLow]);
}

export function alignTokens(params: {
	a: readonly number[];
	b: readonly number[];
	imageOf: number[];
	stack: Region[];
}): void {
	const { a, b, imageOf, stack } = params;
	for (let region = stack.pop(); region !== undefined; region = stack.pop()) {
		let { aLow, aHigh, bLow, bHigh } = region;
		if (aLow === 0 && bLow === 0 && aHigh < a.length) {
			while (aLow < aHigh && bLow < bHigh && a[aHigh - 1] === b[bHigh - 1])
				imageOf[--aHigh] = --bHigh;
		} else {
			while (aLow < aHigh && bLow < bHigh && a[aLow] === b[bLow])
				imageOf[aLow++] = bLow++;
		}
		if (aLow === aHigh || bLow === bHigh) continue;
		const inner = { aLow, aHigh, bLow, bHigh };
		let pairs = uniquePairs({ a, b, region: inner });
		if (pairs.length === 0) pairs = uniqueRunPairs({ a, b, region: inner });
		if (pairs.length === 0) continue;
		let nextA = aLow;
		let nextB = bLow;
		for (const [i, j] of longestChain(pairs)) {
			stack.push({ aLow: nextA, aHigh: i, bLow: nextB, bHigh: j });
			imageOf[i] = j;
			nextA = i + 1;
			nextB = j + 1;
		}
		stack.push({ aLow: nextA, aHigh, bLow: nextB, bHigh });
	}
}

export function copyKey(params: {
	index: WordIndex;
	keys: readonly number[];
	range: SentenceRange;
}): string {
	const { index, keys, range } = params;
	return keys
		.slice(range[0], range[1])
		.filter((id) => index.isWord(id))
		.map((id) => index.fold(id))
		.join(",");
}

export function rawKey(params: {
	keys: readonly number[];
	range: SentenceRange;
}): string {
	return params.keys.slice(params.range[0], params.range[1]).join(",");
}

function sentenceWords(params: {
	index: WordIndex;
	text: string;
	tokens: Tokens;
	range: SentenceRange;
}): number[] {
	const { index, text, tokens, range } = params;
	return index.words(
		text.slice(tokens.starts[range[0]], tokens.ends[range[1] - 1]),
	);
}

export function alignTexts(params: {
	index: WordIndex;
	basis: string;
	text: string;
}): TextAlignment {
	const { index, basis, text } = params;
	const basisTokens = index.tokenize(basis);
	const textTokens = index.tokenize(text);
	const imageOf = new Array<number>(basisTokens.keys.length).fill(-1);
	const basisSentences = index.sentences(basisTokens);
	const textSentences = index.sentences(textTokens);
	const sentencePairs = uniquePairs({
		a: basisSentences.map((range) => rawKey({ keys: basisTokens.keys, range })),
		b: textSentences.map((range) => rawKey({ keys: textTokens.keys, range })),
		region: {
			aLow: 0,
			aHigh: basisSentences.length,
			bLow: 0,
			bHigh: textSentences.length,
		},
	});
	const pairOf = new Array<number>(basisSentences.length).fill(-1);
	const pairedFrom = new Array<number>(textSentences.length).fill(-1);
	for (const [i, j] of sentencePairs) {
		pairOf[i] = j;
		pairedFrom[j] = i;
	}
	const stack: Region[] = [];
	let nextA = 0;
	let nextB = 0;
	for (const [i, j] of longestChain(sentencePairs)) {
		const [low, high] = basisSentences[i];
		const [textLow] = textSentences[j];
		stack.push({ aLow: nextA, aHigh: low, bLow: nextB, bHigh: textLow });
		for (let x = low; x < high; x++) imageOf[x] = textLow + (x - low);
		nextA = high;
		nextB = textLow + (high - low);
	}
	stack.push({
		aLow: nextA,
		aHigh: basisTokens.keys.length,
		bLow: nextB,
		bHigh: textTokens.keys.length,
	});
	alignTokens({ a: basisTokens.keys, b: textTokens.keys, imageOf, stack });

	const textEnds = textSentences.map(([, high]) => high);
	const basisCopyKeys = basisSentences.map((range) =>
		copyKey({ index, keys: basisTokens.keys, range }),
	);
	const textCopyKeys = textSentences.map((range) =>
		copyKey({ index, keys: textTokens.keys, range }),
	);
	const standsAt = basisSentences.map(([low, high], i) => {
		const firstImage = imageOf.slice(low, high).find((image) => image >= 0);
		if (firstImage === undefined) return -1;
		const q = lowerBound(textEnds, firstImage + 1);
		return textCopyKeys[q] === basisCopyKeys[i] ? q : -1;
	});
	const kept = new Array<boolean>(textTokens.keys.length).fill(false);
	for (const image of imageOf) if (image >= 0) kept[image] = true;

	return {
		basis,
		text,
		basisTokens,
		textTokens,
		imageOf,
		basisSentences,
		textSentences,
		basisEnds: basisSentences.map(([, high]) => high),
		textEnds,
		pairOf,
		pairedFrom,
		basisWords: basisSentences.map((range) =>
			sentenceWords({ index, text: basis, tokens: basisTokens, range }),
		),
		textWords: textSentences.map((range) =>
			sentenceWords({ index, text, tokens: textTokens, range }),
		),
		basisCopyKeys,
		textCopyKeys,
		standsAt,
		kept,
		best: new Map(),
		clause: new Map(),
	};
}

export function sentencesAround(params: {
	tokens: Tokens;
	ends: readonly number[];
	span: TextRange;
}): Pair {
	const { tokens, ends, span } = params;
	const firstToken = lowerBound(tokens.ends, span.start + 1);
	const lastToken = Math.max(
		firstToken,
		lowerBound(tokens.starts, span.end) - 1,
	);
	return [
		Math.min(lowerBound(ends, firstToken + 1), ends.length - 1),
		Math.min(lowerBound(ends, lastToken + 1), ends.length - 1),
	];
}

export function sentenceText(params: {
	text: string;
	tokens: Tokens;
	sentences: readonly SentenceRange[];
	first: number;
	last: number;
}): string {
	const { text, tokens, sentences, first, last } = params;
	return text.slice(
		tokens.starts[sentences[first][0]],
		tokens.ends[sentences[last][1] - 1],
	);
}

export function mapSpan(params: {
	basisTokens: Tokens;
	textTokens: Tokens;
	imageOf: readonly number[];
	span: TextRange;
}): TextRange | null {
	const { basisTokens: b, textTokens: n, imageOf: m, span } = params;
	const { start: s, end: e } = span;
	const i0 = lowerBound(b.ends, s + 1);
	const i1 = lowerBound(b.starts, e) - 1;
	if (i0 > i1) return null;
	let k0 = -1;
	let k1 = -1;
	for (let i = i0; i <= i1; i++) {
		if (m[i] >= 0) {
			if (k0 < 0) k0 = i;
			k1 = i;
		}
	}
	let p = i0 - 1;
	while (p >= 0 && m[p] < 0) p--;
	let q = i1 + 1;
	while (q < m.length && m[q] < 0) q++;
	const low = p >= 0 ? m[p] + 1 : 0;
	const high = q < m.length ? m[q] - 1 : n.starts.length - 1;
	let start: number;
	let end: number;
	if (k0 < 0) {
		const a = low + (i0 - p - 1);
		const last = Math.min(high, a + (i1 - i0));
		if (a > last) return null;
		start = n.starts[a];
		end = n.ends[last];
	} else {
		start =
			k0 === i0
				? n.starts[m[i0]] +
					Math.max(
						0,
						Math.min(s - b.starts[i0], n.ends[m[i0]] - n.starts[m[i0]]),
					)
				: n.starts[Math.max(Math.min(low, m[k0]), m[k0] - (k0 - i0))];
		end =
			k1 === i1
				? n.starts[m[i1]] +
					Math.max(
						0,
						Math.min(e - b.starts[i1], n.ends[m[i1]] - n.starts[m[i1]]),
					)
				: n.ends[Math.min(Math.max(high, m[k1]), m[k1] + (i1 - k1))];
	}
	return end > start ? { start, end } : null;
}
