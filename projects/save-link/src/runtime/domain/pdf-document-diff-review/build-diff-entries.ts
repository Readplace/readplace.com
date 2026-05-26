import { diffWordsWithSpace } from "diff";
import type { DiffEntry } from "./pdf-document-diff-review-handler.types";

const CONTEXT_WORDS = 30;

interface PageInput {
	readonly pageIndex: number;
	readonly originalText: string;
	readonly cleanedText: string;
}

/**
 * Build the structured per-document diff entry list that Stage 2's prompt
 * consumes. One pass per page through `diffWordsWithSpace` — preserves
 * inter-word whitespace so the produced offsets line up with the original
 * text byte-for-byte (`diffWords` collapses runs of whitespace and would
 * make `charOffset` ambiguous).
 *
 * Consecutive removed/added regions are collapsed into a single entry so a
 * multi-word replacement like "Veposi- tory" → "Repository" surfaces as one
 * change rather than two. Isolated removals (`replacement === ""`) and
 * isolated additions (`original === ""`) are emitted unchanged.
 *
 * Returns the entries in monotonically increasing `diff_id` order. The
 * orchestrator concatenates entries from all pages so each `diff_id` is
 * unique across the document.
 */
export function buildDiffEntries(pages: ReadonlyArray<PageInput>): DiffEntry[] {
	const entries: DiffEntry[] = [];
	let nextDiffId = 1;
	for (const page of pages) {
		const changes = diffWordsWithSpace(page.originalText, page.cleanedText);
		let originalOffset = 0;
		let i = 0;
		while (i < changes.length) {
			const change = changes[i];
			if (!change.added && !change.removed) {
				originalOffset += change.value.length;
				i += 1;
				continue;
			}
			// Consume the consecutive removed/added run; the diff library can
			// emit them in either order so accumulate both sides defensively.
			const removedStart = originalOffset;
			let removedValue = "";
			let addedValue = "";
			while (i < changes.length && (changes[i].added || changes[i].removed)) {
				const part = changes[i];
				if (part.removed) {
					removedValue += part.value;
					originalOffset += part.value.length;
				} else {
					addedValue += part.value;
				}
				i += 1;
			}
			entries.push({
				diff_id: nextDiffId++,
				pageIndex: page.pageIndex,
				charOffset: removedStart,
				contextBefore: lastWords(page.originalText.slice(0, removedStart), CONTEXT_WORDS),
				original: removedValue,
				replacement: addedValue,
				contextAfter: firstWords(page.originalText.slice(removedStart + removedValue.length), CONTEXT_WORDS),
			});
		}
	}
	return entries;
}

function lastWords(text: string, n: number): string {
	const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
	return words.slice(-n).join(" ");
}

function firstWords(text: string, n: number): string {
	const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
	return words.slice(0, n).join(" ");
}
