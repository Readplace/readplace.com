import { formatTabCountLabel } from "@packages/web-shell";
import { type MailTabKey, buildInboxEmailDetailUrl } from "./inbox-email-detail.url";

const MAIL_TAB_DEFINITIONS: readonly { readonly key: MailTabKey; readonly label: string }[] = [
	{ key: "view", label: "View" },
	{ key: "articles", label: "Extracted Articles" },
	{ key: "excluded", label: "Skipped" },
];

/** How many items each list tab holds, for the `(N)` suffix. A key is absent
 * while its count is still unknown — extraction has not written its meta
 * barrier — so the tab renders its bare label rather than claiming a total the
 * panel can't back yet. `view` renders the email itself and never counts. */
export type MailTabCounts = { readonly [K in MailTabKey]?: number };

export interface MailTab {
	key: MailTabKey;
	label: string;
	href: string;
	ariaCurrent: "page" | undefined;
}

export function buildMailTabs(input: {
	emailId: string;
	active: MailTabKey;
	counts: MailTabCounts;
}): MailTab[] {
	return MAIL_TAB_DEFINITIONS.map(({ key, label }) => {
		const count = input.counts[key];
		return {
			key,
			label: count === undefined ? label : formatTabCountLabel({ label, count }),
			href: buildInboxEmailDetailUrl({ emailId: input.emailId, tab: key }),
			ariaCurrent: key === input.active ? "page" : undefined,
		};
	});
}
