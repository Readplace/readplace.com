import { EMAIL_FEATURE } from "@packages/web-shell";

/** The `feature` flag is carried because the whole inbox surface 404s without it. */
export function buildInboxLinkFeedbackUrl(params: { emailId: string; ordinal: string }): string {
	const search = new URLSearchParams();
	search.set("feature", EMAIL_FEATURE);
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/feedback?${search.toString()}`;
}
