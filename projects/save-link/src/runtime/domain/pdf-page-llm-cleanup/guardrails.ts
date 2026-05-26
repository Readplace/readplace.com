/* Structural guardrails for LLM-cleaned OCR text. Each predicate compares the
 * model's output to the original Tesseract text and returns false when the
 * model strayed beyond what the Stage 1 prompt allows. A rejection means the
 * handler returns the original text verbatim — a visible OCR error is always
 * preferable to a confident hallucination. */

const MAX_LENGTH_DELTA = 0.30;

/**
 * The cleaned text must not differ in length from the original by more than
 * 30%. The Stage 1 prompt only allows removing gibberish, rejoining
 * hyphenations, and fixing single-character substitutions — none of which
 * change byte counts by a meaningful fraction. A 30%+ delta indicates the
 * model rewrote, summarised, or hallucinated content.
 *
 * Edge case: when the original is empty (zero-length pages can happen on
 * blank scans that survived the upstream "no text across all batches"
 * check), the only acceptable cleaned output is also empty.
 */
export function checkLength({ before, after }: { before: string; after: string }): boolean {
	if (before.length === 0) {
		return after.length === 0;
	}
	const delta = Math.abs(after.length - before.length) / before.length;
	return delta <= MAX_LENGTH_DELTA;
}

/**
 * The cleaned text must contain exactly the same multiset of digit runs as
 * the original. Numbers in archival documents (dates, page numbers, catalog
 * IDs, citations) cannot be verified from a single page and are the highest
 * cost silent-error category — the model can confidently swap 1968 for 1986
 * with no surrounding signal that the change is wrong. Compare runs not
 * individual digits so we still notice when "1968" becomes "1986" (different
 * runs, same digit set) but allow re-ordering across the page.
 */
export function checkDigitsPreserved({ before, after }: { before: string; after: string }): boolean {
	const beforeRuns = (before.match(/\d+/g) ?? []).slice().sort();
	const afterRuns = (after.match(/\d+/g) ?? []).slice().sort();
	if (beforeRuns.length !== afterRuns.length) return false;
	for (let i = 0; i < beforeRuns.length; i++) {
		if (beforeRuns[i] !== afterRuns[i]) return false;
	}
	return true;
}

/**
 * The cleaned text must preserve the paragraph structure of the original.
 * Compare line counts and blank-line counts: the prompt explicitly forbids
 * merging/splitting paragraphs, so the gross structure should round-trip
 * verbatim. Trailing whitespace differences are normalised because some
 * models strip the final newline.
 */
export function checkWhitespaceStructure({ before, after }: { before: string; after: string }): boolean {
	const normalisedBefore = before.replace(/\s+$/, "");
	const normalisedAfter = after.replace(/\s+$/, "");
	const beforeLines = normalisedBefore.split("\n").length;
	const afterLines = normalisedAfter.split("\n").length;
	if (beforeLines !== afterLines) return false;
	const beforeBlanks = (normalisedBefore.match(/\n\s*\n/g) ?? []).length;
	const afterBlanks = (normalisedAfter.match(/\n\s*\n/g) ?? []).length;
	return beforeBlanks === afterBlanks;
}

export type GuardrailRejection =
	| "length-delta-exceeded"
	| "digits-mutated"
	| "whitespace-structure-changed";

/**
 * Composite guardrail. Returns the first failing predicate's name so the
 * caller can log a precise reason, or null when every check passes.
 */
export function evaluateGuardrails({ before, after }: { before: string; after: string }): GuardrailRejection | null {
	if (!checkLength({ before, after })) return "length-delta-exceeded";
	if (!checkDigitsPreserved({ before, after })) return "digits-mutated";
	if (!checkWhitespaceStructure({ before, after })) return "whitespace-structure-changed";
	return null;
}
