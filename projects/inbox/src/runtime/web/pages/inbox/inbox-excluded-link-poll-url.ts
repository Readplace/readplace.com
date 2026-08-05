export function buildInboxExcludedLinkPollUrl(params: {
	emailId: string;
	ordinal: string;
	pollCount: number;
}): string {
	const search = new URLSearchParams();
	search.set("poll", String(params.pollCount));
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/excluded?${search.toString()}`;
}
