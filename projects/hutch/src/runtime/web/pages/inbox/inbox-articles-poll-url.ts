import { EMAIL_FEATURE } from "@packages/web-shell";

/**
 * Polling URL for the whole Articles panel while extraction is still running.
 * Sibling of `buildInboxLinkPollUrl`, but it targets the email-level
 * `/inbox/:id/articles` fragment rather than a single card: there are no link
 * rows to poll until the extractor writes its meta barrier, so the panel polls
 * itself and swaps in the finished card set the moment extraction completes. The
 * `feature` flag is carried because the whole inbox surface 404s without it.
 */
export function buildInboxArticlesPollUrl(params: {
	emailId: string;
	pollCount: number;
}): string {
	const search = new URLSearchParams();
	search.set("feature", EMAIL_FEATURE);
	search.set("poll", String(params.pollCount));
	return `/inbox/${encodeURIComponent(params.emailId)}/articles?${search.toString()}`;
}
