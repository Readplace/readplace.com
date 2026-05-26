import type { DiffDecision, DiffEntry } from "./pdf-document-diff-review-handler.types";

const PER_SPAN_MAX_LENGTH_DELTA = 0.5;

interface PageInput {
	readonly pageIndex: number;
	readonly originalText: string;
	readonly cleanedText: string;
}

export interface ApplyDecisionsLog {
	readonly applied: number;
	readonly rejected: number;
	readonly modified: number;
	readonly newApplied: number;
	readonly skippedReasons: ReadonlyArray<{ readonly diff_id: number; readonly reason: string }>;
}

/**
 * Apply Stage 2 decisions on top of each page's original Tesseract text.
 *
 * - APPROVE keeps the stage-1 replacement (splice `entry.replacement` over
 *   `entry.original`).
 * - REJECT keeps the original Tesseract span (no splice).
 * - MODIFY splices `decision.replacement` over `entry.original`.
 * - NEW finds `decision.original` in the per-page text *after* the
 *   stage-1+modify splices and replaces it with `decision.replacement`.
 *   New entries without a unique single match are skipped.
 *
 * Per-decision guardrails reject any change whose `original` digit set
 * differs from the proposed replacement's digit set, or whose length
 * delta exceeds 50% of the span. The whole-document length / digit /
 * whitespace guardrails live at the handler level, not here.
 */
export function applyDecisions(params: {
	readonly pages: ReadonlyArray<PageInput>;
	readonly entries: ReadonlyArray<DiffEntry>;
	readonly decisions: ReadonlyArray<DiffDecision>;
}): { readonly pages: ReadonlyArray<{ readonly pageIndex: number; readonly finalText: string }>; readonly log: ApplyDecisionsLog } {
	const decisionByDiffId = new Map<number, DiffDecision>();
	const newDecisionsByPage = new Map<number, DiffDecision[]>();
	for (const decision of params.decisions) {
		if (decision.decision === "NEW") {
			if (decision.pageIndex === undefined) continue;
			const bucket = newDecisionsByPage.get(decision.pageIndex) ?? [];
			bucket.push(decision);
			newDecisionsByPage.set(decision.pageIndex, bucket);
		} else {
			decisionByDiffId.set(decision.diff_id, decision);
		}
	}

	const skippedReasons: Array<{ diff_id: number; reason: string }> = [];
	let applied = 0;
	let rejected = 0;
	let modified = 0;
	let newApplied = 0;

	const entriesByPage = new Map<number, DiffEntry[]>();
	for (const entry of params.entries) {
		const bucket = entriesByPage.get(entry.pageIndex) ?? [];
		bucket.push(entry);
		entriesByPage.set(entry.pageIndex, bucket);
	}

	const finalPages: Array<{ pageIndex: number; finalText: string }> = [];
	for (const page of params.pages) {
		let text = page.originalText;
		const pageEntries = (entriesByPage.get(page.pageIndex) ?? []).slice()
			.sort((a, b) => b.charOffset - a.charOffset);
		for (const entry of pageEntries) {
			const decision = decisionByDiffId.get(entry.diff_id);
			if (!decision || decision.decision === "REJECT") {
				rejected += 1;
				continue;
			}
			const replacement = decision.decision === "MODIFY"
				? (decision.replacement ?? entry.replacement)
				: entry.replacement;
			const violation = perSpanGuardrail({ original: entry.original, replacement });
			if (violation !== null) {
				skippedReasons.push({ diff_id: entry.diff_id, reason: `guardrail:${violation}` });
				continue;
			}
			text = text.slice(0, entry.charOffset)
				+ replacement
				+ text.slice(entry.charOffset + entry.original.length);
			if (decision.decision === "MODIFY") modified += 1; else applied += 1;
		}

		const pageNewDecisions = newDecisionsByPage.get(page.pageIndex) ?? [];
		for (const decision of pageNewDecisions) {
			if (decision.original === undefined || decision.replacement === undefined) {
				skippedReasons.push({ diff_id: decision.diff_id, reason: "new:missing-fields" });
				continue;
			}
			const violation = perSpanGuardrail({ original: decision.original, replacement: decision.replacement });
			if (violation !== null) {
				skippedReasons.push({ diff_id: decision.diff_id, reason: `guardrail:${violation}` });
				continue;
			}
			const firstIndex = text.indexOf(decision.original);
			if (firstIndex === -1) {
				skippedReasons.push({ diff_id: decision.diff_id, reason: "new:not-found" });
				continue;
			}
			const secondIndex = text.indexOf(decision.original, firstIndex + 1);
			if (secondIndex !== -1) {
				skippedReasons.push({ diff_id: decision.diff_id, reason: "new:ambiguous-match" });
				continue;
			}
			text = text.slice(0, firstIndex)
				+ decision.replacement
				+ text.slice(firstIndex + decision.original.length);
			newApplied += 1;
		}

		finalPages.push({ pageIndex: page.pageIndex, finalText: text });
	}

	return {
		pages: finalPages,
		log: { applied, rejected, modified, newApplied, skippedReasons },
	};
}

function perSpanGuardrail(params: { original: string; replacement: string }): string | null {
	// Compare digit multisets via a sorted-join: catches re-ordered runs,
	// avoids a phantom branch the for-loop variant introduces in V8 block
	// coverage. See https://v8.dev/blog/javascript-code-coverage.
	const beforeDigits = sortedDigitRuns(params.original);
	const afterDigits = sortedDigitRuns(params.replacement);
	if (beforeDigits !== afterDigits) return "digits-mutated";
	// Length delta is only meaningful when both sides are non-empty. Pure
	// insertions (original=="") and pure removals (replacement=="") are the
	// expected shapes for gibberish deletion and missed-word insertion — both
	// would always show 100% delta and would be silently dropped if checked,
	// defeating the point of the NEW path.
	if (params.original.length === 0 || params.replacement.length === 0) return null;
	const delta = Math.abs(params.replacement.length - params.original.length) / params.original.length;
	if (delta > PER_SPAN_MAX_LENGTH_DELTA) return "length-delta-exceeded";
	return null;
}

function sortedDigitRuns(text: string): string {
	const runs = text.match(/\d+/g);
	if (runs === null) return "";
	return runs.slice().sort().join(",");
}
