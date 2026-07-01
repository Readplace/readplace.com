import type { Article } from "../article.types";
import type { Effect } from "../effects.types";
import type { AggregateField } from "../storage.types";
import { synthesiseStub } from "./submit-link";

export interface EnsureCanonicalStubInput {
	url: string;
	now: string;
}

/* Guarantees a canonical aggregate row exists so select-content's promoteTier
 * (which asserts the row loads) can fill it in-place. Unlike submitLink it emits
 * NO dispatch-submit-link effect — the canonical must not re-enter the submit
 * pipeline; the finalized tier source is written under it directly. Idempotent:
 * an existing row (e.g. an extension save already keyed the canonical) is a
 * no-op, so a redelivery never resets a ready canonical back to pending. */
export function ensureCanonicalStub(
	article: Article | undefined,
	input: EnsureCanonicalStubInput,
): {
	article: Article;
	effects: readonly Effect[];
	writes: readonly AggregateField[];
} {
	if (article !== undefined) {
		return { article, effects: [], writes: [] };
	}
	return {
		article: synthesiseStub({ url: input.url, now: input.now }),
		effects: [],
		writes: ["crawl", "summary", "metadata", "freshness"],
	};
}
