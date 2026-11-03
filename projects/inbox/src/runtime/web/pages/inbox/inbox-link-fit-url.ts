import {
	type InboxEmailPageState,
	inboxEmailPageStateQuery,
} from "./inbox-email-detail.url";

export function buildInboxLinkFitUrl(params: {
	emailId: string;
	ordinal: string;
	pageState: InboxEmailPageState;
}): string {
	const path = `/inbox/${encodeURIComponent(params.emailId)}/links/${params.ordinal}/fit`;
	const query = inboxEmailPageStateQuery(params.pageState);
	return query === "" ? path : `${path}?${query}`;
}
