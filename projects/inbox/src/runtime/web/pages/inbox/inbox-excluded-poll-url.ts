
/**
 * Polling URL for the whole Skipped panel while extraction is still running.
 * Sibling of `buildInboxArticlesPollUrl`, pointing at this panel's own
 * `/inbox/:id/excluded` fragment: the two panels swap themselves in place, so a
 * shared URL would make the Skipped panel replace itself with Articles markup on
 * the first tick.
 */
export function buildInboxExcludedPollUrl(params: {
	emailId: string;
	pollCount: number;
}): string {
	const search = new URLSearchParams();
	search.set("poll", String(params.pollCount));
	return `/inbox/${encodeURIComponent(params.emailId)}/excluded?${search.toString()}`;
}
