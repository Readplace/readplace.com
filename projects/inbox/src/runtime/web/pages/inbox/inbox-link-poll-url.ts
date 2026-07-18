import { EMAIL_FEATURE } from "@packages/web-shell";

/** The `feature` flag is carried because the whole inbox surface 404s without it. */
export function buildInboxLinkPollUrl(params: {
	emailId: string;
	ordinal: string;
	pollCount: number;
}): string {
	const search = new URLSearchParams();
	search.set("feature", EMAIL_FEATURE);
	search.set("poll", String(params.pollCount));
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/card?${search.toString()}`;
}
