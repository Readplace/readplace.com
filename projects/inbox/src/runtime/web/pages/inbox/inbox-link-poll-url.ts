
export function buildInboxLinkPollUrl(params: {
	emailId: string;
	ordinal: string;
	pollCount: number;
	shown: number;
	awaitSave?: boolean;
}): string {
	const search = new URLSearchParams();
	search.set("poll", String(params.pollCount));
	search.set("shown", String(params.shown));
	if (params.awaitSave === true) search.set("awaitSave", "1");
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/card?${search.toString()}`;
}
