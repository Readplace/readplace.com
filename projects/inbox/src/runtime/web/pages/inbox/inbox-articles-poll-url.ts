
/**
 * Polling URL for the whole Articles panel while extraction is still running.
 * Sibling of `buildInboxLinkPollUrl`, but it targets the email-level
 * `/inbox/:id/articles` fragment rather than a single card: there are no link
 * rows to poll until the extractor writes its meta barrier, so the panel polls
 * itself and swaps in the finished card set the moment extraction completes.
 */
export function buildInboxArticlesPollUrl(params: {
	emailId: string;
	pollCount: number;
}): string {
	const search = new URLSearchParams();
	search.set("poll", String(params.pollCount));
	return `/inbox/${encodeURIComponent(params.emailId)}/articles?${search.toString()}`;
}
