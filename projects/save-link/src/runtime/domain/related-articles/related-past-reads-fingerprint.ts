import { createHash } from "node:crypto";
import type { RelatedArticleTarget } from "./related-articles-selector";

/** Bump when the past-reads prompt or selection logic changes, so a settled
 * result recomputes on the next visit rather than serving a stale answer that
 * a fresh candidate set alone would not have invalidated. */
export const PAST_READS_SELECTOR_VERSION = 1;

/** A deterministic signature of everything a past-reads computation depends on:
 * the selector version, the article being read, and the exact set of past-read
 * candidates. When it matches the last stored fingerprint the inputs are
 * unchanged and the worker reuses the cached result instead of calling the
 * model again. */
export function computePastReadsFingerprint(input: {
	target: RelatedArticleTarget & { url: string };
	candidateUrls: readonly string[];
}): string {
	const payload = JSON.stringify({
		version: PAST_READS_SELECTOR_VERSION,
		target: {
			url: input.target.url,
			title: input.target.title,
			siteName: input.target.siteName,
			description: input.target.description,
		},
		candidates: [...input.candidateUrls].sort(),
	});
	return createHash("sha256").update(payload).digest("hex");
}
