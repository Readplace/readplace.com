import {
	type InboxEmailFilter,
	writeInboxEmailFilter,
} from "./inbox-email-filter";

export function buildInboxLinkPollUrl(params: {
	emailId: string;
	ordinal: string;
	pollCount: number;
	shown: number;
	awaitSave?: boolean;
	filter?: InboxEmailFilter;
}): string {
	const search = new URLSearchParams();
	search.set("poll", String(params.pollCount));
	search.set("shown", String(params.shown));
	if (params.awaitSave === true) search.set("awaitSave", "1");
	writeInboxEmailFilter({ search, filter: params.filter });
	return `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/card?${search.toString()}`;
}
