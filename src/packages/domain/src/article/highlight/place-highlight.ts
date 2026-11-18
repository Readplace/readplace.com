import assert from "node:assert";
import { anchorHighlightFuzzy } from "./anchor-highlight-fuzzy";
import {
	type PlaceableHighlight,
	relocateHighlight,
} from "./highlight-on-page";
import {
	alignTexts,
	alignTokens,
	copyKey,
	lowerBound,
	mapSpan,
	rawKey,
	sentencesAround,
	sentenceText,
	type TextAlignment,
} from "./text-alignment";
import {
	occurrencesOf,
	sameWords,
	snapToWords,
	type TextRange,
} from "./text-anchoring";
import {
	aboveSimilarity,
	MIN_SIMILARITY,
	type Tokens,
	type WordIndex,
} from "./word-index";

type PlacingLevel = "today" | "missing" | "mismatch" | "diff";
type RefusalReason = "gone" | "notPlaced";
type PlacingRoute = "carry" | "fallback" | "elsewhere" | "copies";

export interface PlacingHighlight extends PlaceableHighlight {
	orderKey: number;
}

export type HighlightPlacing =
	| {
			anchorState: "anchored" | "moved";
			start: number;
			end: number;
			orderKey: number;
			level: PlacingLevel;
			edited: boolean;
			route?: PlacingRoute;
			granted: boolean;
		}
	| {
			anchorState: "orphaned";
			start: number;
			end: number;
			orderKey: number;
			level: PlacingLevel;
			edited: false;
			reason?: RefusalReason;
			granted: boolean;
		};

export interface PlacingContext {
	index: WordIndex;
	text: string;
	contentHash: string;
	alignments: Map<string, TextAlignment>;
}

export type BasisText =
	| { kind: "basis"; text: string }
	| { kind: "missing" }
	| { kind: "anchor"; text: string }
	| { kind: "none" };

function alignmentFor(params: {
	context: PlacingContext;
	basis: string;
}): TextAlignment {
	const { context, basis } = params;
	const known = context.alignments.get(basis);
	if (known !== undefined) return known;
	const alignment = alignTexts({
		index: context.index,
		basis,
		text: context.text,
	});
	context.alignments.set(basis, alignment);
	return alignment;
}

function snapPlace(params: {
	text: string;
	place: TextRange | null;
	exact: string;
}): TextRange | null {
	const { text, place, exact } = params;
	return place === null ? null : snapToWords({ text, range: place, exact });
}

function placeAsToday(params: {
	context: PlacingContext;
	row: PlacingHighlight;
	level: PlacingLevel;
	granted: boolean;
}): HighlightPlacing {
	const { context, row, level, granted } = params;
	const anchor = anchorHighlightFuzzy({
		text: context.text,
		contentHash: context.contentHash,
		highlight: row,
	});
	if (anchor.anchorState === "orphaned") {
		return {
			anchorState: "orphaned",
			start: anchor.start,
			end: anchor.end,
			orderKey: row.orderKey,
			level,
			edited: false,
			granted,
		};
	}
	return {
		anchorState: anchor.anchorState,
		start: anchor.start,
		end: anchor.end,
		orderKey: anchor.start,
		level,
		edited: !sameWords({
			place: context.text.slice(anchor.start, anchor.end),
			quote: row.exact,
		}),
		granted,
	};
}

function bestMatch(params: {
	alignment: TextAlignment;
	index: WordIndex;
	side: "basis" | "text";
	x: number;
	skip: ReadonlySet<number>;
}): number {
	const { alignment, index, side, x, skip } = params;
	const cacheable = skip.size === 0;
	const key = `${side}${x}`;
	const known = cacheable ? alignment.best.get(key) : undefined;
	if (known !== undefined) return known;
	const measure = (j: number, plain: boolean) =>
		side === "basis"
			? index.corr({
					a: alignment.basisWords[x],
					b: alignment.textWords[j],
					plain,
				})
			: index.corr({
					a: alignment.basisWords[j],
					b: alignment.textWords[x],
					plain,
				});
	const count =
		side === "basis" ? alignment.textWords.length : alignment.basisWords.length;
	let top = -1;
	let at = -1;
	let tie = false;
	for (let j = 0; j < count; j++) {
		if (skip.has(j)) continue;
		const value = measure(j, true);
		if (value > top) {
			top = value;
			at = j;
			tie = false;
		} else if (value === top) tie = true;
	}
	const best = tie || at < 0 || !aboveSimilarity(measure(at, false)) ? -1 : at;
	if (cacheable) alignment.best.set(key, best);
	return best;
}

function fallbackPair(params: {
	alignment: TextAlignment;
	index: WordIndex;
	x: number;
}): number {
	const { alignment, index, x } = params;
	const twins = new Set<number>();
	const partners = new Set<number>();
	alignment.basisCopyKeys.forEach((key, i) => {
		if (
			i !== x &&
			alignment.standsAt[i] >= 0 &&
			key === alignment.basisCopyKeys[x]
		) {
			twins.add(i);
			partners.add(alignment.standsAt[i]);
		}
	});
	const j = bestMatch({ alignment, index, side: "basis", x, skip: partners });
	return j >= 0 &&
		bestMatch({ alignment, index, side: "text", x: j, skip: twins }) === x
		? j
		: -1;
}

function subTokens(params: {
	tokens: Tokens;
	low: number;
	high: number;
}): Tokens {
	const { tokens, low, high } = params;
	return {
		starts: tokens.starts.slice(low, high),
		ends: tokens.ends.slice(low, high),
		keys: tokens.keys.slice(low, high),
	};
}

function fallbackPlace(params: {
	alignment: TextAlignment;
	index: WordIndex;
	span: TextRange;
}): TextRange | null {
	const { alignment, index, span } = params;
	const { basisTokens, textTokens, basisSentences, textSentences, basisEnds } =
		alignment;
	const a = lowerBound(
		basisEnds,
		lowerBound(basisTokens.ends, span.start + 1) + 1,
	);
	const b = lowerBound(basisEnds, lowerBound(basisTokens.starts, span.end));
	if (a > b || b >= basisSentences.length) return null;
	let first = -1;
	for (let x = a; x <= b; x++) {
		const j = fallbackPair({ alignment, index, x });
		if (j < 0 || (x > a && j !== first + (x - a))) return null;
		if (x === a) first = j;
	}
	const basisPart = subTokens({
		tokens: basisTokens,
		low: basisSentences[a][0],
		high: basisSentences[b][1],
	});
	const textPart = subTokens({
		tokens: textTokens,
		low: textSentences[first][0],
		high: textSentences[first + b - a][1],
	});
	const imageOf = new Array<number>(basisPart.keys.length).fill(-1);
	alignTokens({
		a: basisPart.keys,
		b: textPart.keys,
		imageOf,
		stack: [
			{
				aLow: 0,
				aHigh: basisPart.keys.length,
				bLow: 0,
				bHigh: textPart.keys.length,
			},
		],
	});
	return mapSpan({
		basisTokens: basisPart,
		textTokens: textPart,
		imageOf,
		span,
	});
}

function placeOnBasis(params: {
	context: PlacingContext;
	row: PlacingHighlight;
	basis: string;
	at: TextRange;
	granted: boolean;
}): HighlightPlacing {
	const { context, row, basis, at, granted } = params;
	const { index, text } = context;
	const alignment = alignmentFor({ context, basis });
	const {
		basisTokens,
		textTokens,
		basisSentences,
		textSentences,
		basisEnds,
		textEnds,
		pairOf,
		pairedFrom,
	} = alignment;
	const mine =
		row.basisQuote === undefined ? [row.exact] : [row.exact, row.basisQuote];
	const [a, b] = sentencesAround({
		tokens: basisTokens,
		ends: basisEnds,
		span: at,
	});
	const textSentencesAt = (place: TextRange) =>
		sentencesAround({ tokens: textTokens, ends: textEnds, span: place });

	const clause = (place: TextRange): number => {
		const [c, d] = textSentencesAt(place);
		assert(
			a >= 0 && c >= 0,
			"a placed span lies in a sentence of each version",
		);
		const key = `${a},${b},${c},${d}`;
		const known = alignment.clause.get(key);
		if (known !== undefined) return known;
		const value = index.sentenceShare({
			was: sentenceText({
				text: basis,
				tokens: basisTokens,
				sentences: basisSentences,
				first: a,
				last: b,
			}),
			now: sentenceText({
				text,
				tokens: textTokens,
				sentences: textSentences,
				first: c,
				last: d,
			}),
		});
		alignment.clause.set(key, value);
		return value;
	};

	const refuse = (place: TextRange): RefusalReason | null => {
		const words = text.slice(place.start, place.end);
		if (
			Math.max(...mine.map((quote) => index.share({ quote, place: words }))) <
			MIN_SIMILARITY
		)
			return "notPlaced";
		const [c, d] = textSentencesAt(place);
		let foreign = false;
		for (let j = c; j <= d; j++) {
			const i = pairedFrom[j];
			if (i >= 0 && (i < a || i > b)) foreign = true;
		}
		let inside = 0;
		let away = false;
		for (let x = a; x <= b; x++) {
			const j = pairOf[x];
			if (j >= c && j <= d) inside++;
			if (j >= 0 && (j < c || j > d)) away = true;
		}
		if (foreign && inside !== b - a + 1) return "notPlaced";
		const same =
			!away && mine.some((quote) => sameWords({ place: words, quote }));
		return same || aboveSimilarity(clause(place)) ? null : "notPlaced";
	};

	let found: { place: TextRange; route: PlacingRoute } | undefined;
	let why: RefusalReason = "gone";
	const carried = snapPlace({
		text,
		place: mapSpan({
			basisTokens,
			textTokens,
			imageOf: alignment.imageOf,
			span: at,
		}),
		exact: row.exact,
	});
	if (carried !== null) {
		const reason = refuse(carried);
		if (reason === null) found = { place: carried, route: "carry" };
		else why = reason;
	}
	if (found === undefined) {
		const moved = snapPlace({
			text,
			place: fallbackPlace({ alignment, index, span: at }),
			exact: row.exact,
		});
		if (moved !== null) {
			const reason = refuse(moved);
			if (reason === null) found = { place: moved, route: "fallback" };
			else why = reason;
		}
	}
	if (found === undefined) {
		const words = row.basisQuote ?? row.exact;
		const elsewhere = occurrencesOf({ text, exact: words })
			.map((start) => ({ start, end: start + words.length }))
			.find((candidate) => {
				const first = lowerBound(textTokens.ends, candidate.start + 1);
				const last = lowerBound(textTokens.starts, candidate.end);
				const free = alignment.kept
					.slice(first, last)
					.filter((kept) => !kept).length;
				return (
					free / (last - first) >= MIN_SIMILARITY &&
					clause(candidate) === 1 &&
					refuse(candidate) === null
				);
			});
		if (elsewhere !== undefined)
			found = { place: elsewhere, route: "elsewhere" };
	}

	const gone = found === undefined && why === "gone";
	const keyOf = (keys: readonly number[], range: readonly [number, number]) =>
		gone ? copyKey({ index, keys, range }) : rawKey({ keys, range });
	const basisKeys = basisSentences.map((range) =>
		keyOf(basisTokens.keys, range),
	);
	const textKeys = textSentences.map((range) => keyOf(textTokens.keys, range));
	const mineKeys = new Set(basisKeys.slice(a, b + 1));
	const count = (keys: readonly string[], key: string) =>
		keys.filter((other) => other === key).length;
	const inCopies = (span: TextRange) => {
		const [c, d] = textSentencesAt(span);
		return textKeys.slice(c, d + 1).every((key) => mineKeys.has(key));
	};
	const standing = found === undefined ? carried : found.place;
	const copied = [...mineKeys].some(
		(key) => count(basisKeys, key) > 1 || count(textKeys, key) > 1,
	);
	if (copied && (gone || (standing !== null && inCopies(standing)))) {
		const today = placeAsToday({
			context,
			row: { ...row, exact: basis.slice(at.start, at.end) },
			level: "diff",
			granted,
		});
		if (today.anchorState !== "orphaned" && inCopies(today))
			found = { place: today, route: "copies" };
	}

	if (found === undefined) {
		return {
			anchorState: "orphaned",
			start: row.start,
			end: row.end,
			orderKey: row.orderKey,
			level: "diff",
			edited: false,
			reason: why,
			granted,
		};
	}
	const { place, route } = found;
	const edited = !sameWords({
		place: text.slice(place.start, place.end),
		quote: row.exact,
	});
	return {
		anchorState: !edited && place.start === row.start ? "anchored" : "moved",
		start: place.start,
		end: place.end,
		orderKey: place.start,
		level: "diff",
		edited,
		route,
		granted,
	};
}

export function placeHighlight(params: {
	context: PlacingContext;
	row: PlacingHighlight;
	basis: BasisText;
}): HighlightPlacing {
	const { context, row, basis } = params;
	if (basis.kind === "anchor") {
		const at = relocateHighlight({ text: basis.text, highlight: row });
		if (at !== undefined)
			return placeOnBasis({
				context,
				row,
				basis: basis.text,
				at,
				granted: true,
			});
	}
	if (basis.kind === "missing")
		return placeAsToday({ context, row, level: "missing", granted: false });
	if (basis.kind !== "basis")
		return placeAsToday({ context, row, level: "today", granted: false });
	const at = relocateHighlight({ text: basis.text, highlight: row });
	if (at === undefined) {
		return {
			anchorState: "orphaned",
			start: row.start,
			end: row.end,
			orderKey: row.orderKey,
			level: "mismatch",
			edited: false,
			reason: "notPlaced",
			granted: false,
		};
	}
	return placeOnBasis({ context, row, basis: basis.text, at, granted: false });
}
