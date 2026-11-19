const TOKEN =
	/\n|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
const WORD = /^[\p{L}\p{N}]/u;
const MAX_SENTENCE_WORDS = 100;

export const MIN_SIMILARITY = 0.5;

export function aboveSimilarity(value: number): boolean {
	return value > MIN_SIMILARITY;
}

export interface Tokens {
	starts: number[];
	ends: number[];
	keys: number[];
}

export type SentenceRange = readonly [number, number];

export interface WordIndex {
	tokenize(text: string): Tokens;
	tokensOf(text: string): number[];
	words(text: string): number[];
	isWord(id: number): boolean;
	fold(id: number): string;
	near(pair: { a: number; b: number }): boolean;
	dice(pair: { a: readonly number[]; b: readonly number[] }): number;
	corr(pair: {
		a: readonly number[];
		b: readonly number[];
		plain: boolean;
	}): number;
	share(pair: { quote: string; place: string }): number;
	sentenceShare(pair: { was: string; now: string }): number;
	sentences(tokens: Tokens): SentenceRange[];
}

function letterPairsOf(key: string): {
	pairs: Map<string, number>;
	count: number;
} {
	const letters = [...key];
	const pairs = new Map<string, number>();
	for (let i = 0; i + 1 < letters.length; i++) {
		const pair = letters[i] + letters[i + 1];
		pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
	}
	return { pairs, count: Math.max(0, letters.length - 1) };
}

export function createWordIndex(): WordIndex {
	const ids = new Map<string, number>();
	const wordy: boolean[] = [];
	const lengthOf: number[] = [];
	const foldOf: string[] = [];
	const letterPairs: { pairs: Map<string, number>; count: number }[] = [];
	const nearMemo = new Map<string, boolean>();

	function idOf(key: string): number {
		const known = ids.get(key);
		if (known !== undefined) return known;
		const id = wordy.length;
		ids.set(key, id);
		wordy.push(WORD.test(key));
		lengthOf.push([...key].length);
		foldOf.push(key.toLowerCase());
		letterPairs.push(letterPairsOf(key));
		return id;
	}

	const newLine = idOf("\n");
	const stops = new Set([".", "!", "?", "।", "。", "！", "？"].map(idOf));
	const wide = new Set(["。", "！", "？"].map(idOf));
	const closers = new Set(['"', "”"].map(idOf));

	function tokenize(text: string): Tokens {
		const tokens: Tokens = { starts: [], ends: [], keys: [] };
		for (const match of text.matchAll(TOKEN)) {
			tokens.starts.push(match.index);
			tokens.ends.push(match.index + match[0].length);
			tokens.keys.push(idOf(match[0]));
		}
		return tokens;
	}

	function tokensOf(text: string): number[] {
		return tokenize(text).keys.filter((id) => id !== newLine);
	}

	function words(text: string): number[] {
		return tokensOf(text).filter((id) => wordy[id]);
	}

	function near(pair: { a: number; b: number }): boolean {
		const { a, b } = pair;
		if (a === b || foldOf[a] === foldOf[b]) return true;
		const key = `${Math.min(a, b)},${Math.max(a, b)}`;
		const known = nearMemo.get(key);
		if (known !== undefined) return known;
		const left = letterPairs[a];
		const right = letterPairs[b];
		let shared = 0;
		for (const [pair, count] of left.pairs)
			shared += Math.min(count, right.pairs.get(pair) ?? 0);
		const value = aboveSimilarity((2 * shared) / (left.count + right.count));
		nearMemo.set(key, value);
		return value;
	}

	function dice(pair: { a: readonly number[]; b: readonly number[] }): number {
		const { a, b } = pair;
		if (a.length === 0 || b.length === 0) return 0;
		let previous = new Array<number>(b.length + 1).fill(0);
		let current = new Array<number>(b.length + 1).fill(0);
		for (let i = 1; i <= a.length; i++) {
			for (let j = 1; j <= b.length; j++) {
				current[j] = near({ a: a[i - 1], b: b[j - 1] })
					? previous[j - 1] + 1
					: Math.max(previous[j], current[j - 1]);
			}
			[previous, current] = [current, previous];
		}
		return (2 * previous[b.length]) / (a.length + b.length);
	}

	function corr(pair: {
		a: readonly number[];
		b: readonly number[];
		plain: boolean;
	}): number {
		const { a, b, plain } = pair;
		if (a.length === 0 || b.length === 0) return 0;
		const weightsA = a.map((id) => lengthOf[id]);
		const weightsB = b.map((id) => lengthOf[id]);
		let previous = new Array<number>(b.length + 1).fill(0);
		let current = new Array<number>(b.length + 1).fill(0);
		for (let i = 1; i <= a.length; i++) {
			for (let j = 1; j <= b.length; j++) {
				current[j] = Math.max(
					previous[j],
					current[j - 1],
					near({ a: a[i - 1], b: b[j - 1] })
						? previous[j - 1] + Math.min(weightsA[i - 1], weightsB[j - 1])
						: 0,
				);
			}
			[previous, current] = [current, previous];
		}
		const shared = previous[b.length];
		const totalA = weightsA.reduce((sum, weight) => sum + weight, 0);
		const totalB = weightsB.reduce((sum, weight) => sum + weight, 0);
		const contained = shared === totalA || shared === totalB;
		return !plain && contained ? 1 : (2 * shared) / (totalA + totalB);
	}

	function share(pair: { quote: string; place: string }): number {
		const quoteWords = words(pair.quote);
		return quoteWords.length > 0
			? dice({ a: quoteWords, b: words(pair.place) })
			: dice({ a: tokensOf(pair.quote), b: tokensOf(pair.place) });
	}

	function sentenceShare(pair: { was: string; now: string }): number {
		const wasWords = words(pair.was);
		return wasWords.length > 0
			? corr({ a: wasWords, b: words(pair.now), plain: false })
			: corr({ a: tokensOf(pair.was), b: tokensOf(pair.now), plain: false });
	}

	function sentences(tokens: Tokens): SentenceRange[] {
		const { starts, ends, keys } = tokens;
		const out: SentenceRange[] = [];
		const count = keys.length;
		let low = 0;
		let wordCount = 0;
		for (let i = 0; i < count; i++) {
			const key = keys[i];
			if (key === newLine) {
				if (i > low) out.push([low, i]);
				low = i + 1;
				wordCount = 0;
			} else if (stops.has(key)) {
				let last = i;
				while (
					last + 1 < count &&
					closers.has(keys[last + 1]) &&
					starts[last + 1] === ends[last]
				)
					last++;
				if (
					wide.has(key) ||
					last + 1 === count ||
					starts[last + 1] > ends[last]
				) {
					out.push([low, last + 1]);
					low = last + 1;
					wordCount = 0;
					i = last;
				}
			} else if (wordy[key] && ++wordCount >= MAX_SENTENCE_WORDS) {
				out.push([low, i + 1]);
				low = i + 1;
				wordCount = 0;
			}
		}
		if (count > low) out.push([low, count]);
		return out;
	}

	return {
		tokenize,
		tokensOf,
		words,
		isWord: (id) => wordy[id],
		fold: (id) => foldOf[id],
		near,
		dice,
		corr,
		share,
		sentenceShare,
		sentences,
	};
}
