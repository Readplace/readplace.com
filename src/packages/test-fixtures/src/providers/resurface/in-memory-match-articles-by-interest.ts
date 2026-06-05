import type { MatchArticlesByInterest, ResurfaceCandidate } from "./resurface.types";

function matchesAnyTerm(candidate: ResurfaceCandidate, terms: readonly string[]): boolean {
	const haystack = `${candidate.title} ${candidate.text}`.toLowerCase();
	return terms.some((term) => haystack.includes(term));
}

/** Deterministic stand-in for the DeepSeek-backed matcher. Local dev and tests
 * never call a real LLM, so a candidate "matches" when its title or text
 * contains any whitespace-delimited word from the prompt (case-insensitive).
 * Candidate order is preserved so callers get a stable, assertable result. */
export function createKeywordMatchArticlesByInterest(): MatchArticlesByInterest {
	return async ({ prompt, candidates }) => {
		const terms = prompt
			.toLowerCase()
			.split(/\s+/)
			.filter((term) => term.length > 0);
		const matchedIds = candidates
			.filter((candidate) => matchesAnyTerm(candidate, terms))
			.map((candidate) => candidate.id);
		return { matchedIds };
	};
}
