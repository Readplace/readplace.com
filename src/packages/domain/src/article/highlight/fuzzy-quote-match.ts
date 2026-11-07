import search from "approx-string-match";
import type { TextQuoteSelector } from "./highlight";
import {
	FUZZY_MAX_ERROR_RATIO,
	FUZZY_MAX_ERRORS,
	MIN_CONTEXT_SIMILARITY,
	MIN_QUOTE_SIMILARITY,
	MIN_RUNNER_UP_GAP,
	MIN_SCORE,
} from "./text-anchoring";

export type FuzzyAnchor =
	| { start: number; end: number; state: "anchored" | "moved" }
	| { state: "orphaned" };

interface Candidate {
	start: number;
	end: number;
	errors: number;
}

interface ScoredCandidate extends Candidate {
	quote: number;
	prefix: number;
	suffix: number;
	score: number;
}

function fuzzyMaxErrors(patternLength: number): number {
	return Math.min(
		FUZZY_MAX_ERRORS,
		Math.ceil(FUZZY_MAX_ERROR_RATIO * patternLength),
	);
}

function editDistance(params: { stored: string; served: string }): number {
	const { stored, served } = params;
	let previous = Array.from({ length: served.length + 1 }, (_, j) => j);
	for (let i = 1; i <= stored.length; i++) {
		const current = [i];
		for (let j = 1; j <= served.length; j++) {
			const substitution = stored[i - 1] === served[j - 1] ? 0 : 1;
			current.push(
				Math.min(
					previous[j] + 1,
					current[j - 1] + 1,
					previous[j - 1] + substitution,
				),
			);
		}
		previous = current;
	}
	return previous[served.length];
}

function contextSimilarity(params: { stored: string; served: string }): number {
	if (params.stored.length === 0) return 1;
	return 1 - editDistance(params) / params.stored.length;
}

function candidatesThroughContext(params: {
	text: string;
	selector: TextQuoteSelector;
}): Candidate[] {
	const { text, selector } = params;
	const pattern = selector.prefix + selector.exact + selector.suffix;
	return search(text, pattern, fuzzyMaxErrors(pattern.length)).flatMap(
		(window) => {
			const [inner] = search(
				text.slice(window.start, window.end),
				selector.exact,
				fuzzyMaxErrors(selector.exact.length),
			).sort(
				(a, b) =>
					Math.abs(a.start - selector.prefix.length) -
					Math.abs(b.start - selector.prefix.length),
			);
			if (inner === undefined) return [];
			return [
				{
					start: window.start + inner.start,
					end: window.start + inner.end,
					errors: inner.errors,
				},
			];
		},
	);
}

function scoreCandidate(params: {
	text: string;
	selector: TextQuoteSelector;
	hintStart: number;
	candidate: Candidate;
}): ScoredCandidate {
	const { text, selector, hintStart, candidate } = params;
	const quote = 1 - candidate.errors / selector.exact.length;
	const prefix = contextSimilarity({
		stored: selector.prefix,
		served: text.slice(
			Math.max(0, candidate.start - selector.prefix.length),
			candidate.start,
		),
	});
	const suffix = contextSimilarity({
		stored: selector.suffix,
		served: text.slice(candidate.end, candidate.end + selector.suffix.length),
	});
	const position = 1 - Math.abs(candidate.start - hintStart) / text.length;
	return {
		...candidate,
		quote,
		prefix,
		suffix,
		score: (50 * quote + 20 * prefix + 20 * suffix + 2 * position) / 92,
	};
}

export function findFuzzyAnchor(params: {
	text: string;
	selector: TextQuoteSelector;
	hintStart: number;
}): FuzzyAnchor {
	const { text, selector, hintStart } = params;
	const scored = [
		...search(text, selector.exact, fuzzyMaxErrors(selector.exact.length)),
		...candidatesThroughContext({ text, selector }),
	]
		.map((candidate) =>
			scoreCandidate({ text, selector, hintStart, candidate }),
		)
		.sort((a, b) => b.score - a.score);
	const [best] = scored;
	if (best === undefined) return { state: "orphaned" };
	const contested = scored.some(
		(other) =>
			Math.max(other.start - best.end, best.start - other.end) >= 0 &&
			other.score > best.score - MIN_RUNNER_UP_GAP,
	);
	const weak =
		(best.prefix < MIN_CONTEXT_SIMILARITY &&
			best.suffix < MIN_CONTEXT_SIMILARITY) ||
		best.score < MIN_SCORE ||
		best.quote < MIN_QUOTE_SIMILARITY;
	if (contested || weak) return { state: "orphaned" };
	return {
		start: best.start,
		end: best.end,
		state:
			text.slice(best.start, best.end) === selector.exact
				? "anchored"
				: "moved",
	};
}
