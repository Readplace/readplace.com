import { type MailTabKey, buildInboxEmailDetailUrl } from "./inbox-email-detail.url";

const MAIL_TAB_DEFINITIONS: readonly { readonly key: MailTabKey; readonly label: string }[] = [
	{ key: "view", label: "View" },
	{ key: "articles", label: "Extracted Articles" },
];

export interface MailTab {
	key: MailTabKey;
	label: string;
	href: string;
	ariaCurrent: "page" | undefined;
}

export function buildMailTabs(input: { emailId: string; active: MailTabKey }): MailTab[] {
	return MAIL_TAB_DEFINITIONS.map(({ key, label }) => ({
		key,
		label,
		href: buildInboxEmailDetailUrl({ emailId: input.emailId, tab: key }),
		ariaCurrent: key === input.active ? "page" : undefined,
	}));
}
