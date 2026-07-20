
/** The `feature` flag is carried because the whole inbox surface 404s without it. */
export function buildInboxLinkPollUrl(params: {
	emailId: string;
	ordinal: string;
	pollCount: number;
	shown: number;
}): string {
	const search = new URLSearchParams();
	search.set("poll", String(params.pollCount));
	search.set("shown", String(params.shown));
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/card?${search.toString()}`;
}
