import { EMAIL_FEATURE } from "@packages/web-shell";

/**
 * Polling URL for the whole Skipped Links panel while extraction is still running.
 * Sibling of `buildInboxArticlesPollUrl`, pointing at this panel's own
 * `/inbox/:id/excluded` fragment: the two panels swap themselves in place, so a
 * shared URL would make the Skipped panel replace itself with Articles markup on
 * the first tick. The `feature` flag is carried because the whole inbox surface
 * 404s without it, and htmx never swaps a 4xx — the panel would tick against a
 * dead URL forever.
 */
export function buildInboxExcludedPollUrl(params: {
	emailId: string;
	pollCount: number;
}): string {
	const search = new URLSearchParams();
	search.set("feature", EMAIL_FEATURE);
	search.set("poll", String(params.pollCount));
	return `/inbox/${encodeURIComponent(params.emailId)}/excluded?${search.toString()}`;
}
