import { formatTabCountLabel, withInternalTracking } from "@packages/web-shell";
import { type MailTabKey, buildInboxEmailDetailUrl } from "./inbox-email-detail.url";

const MAIL_TAB_DEFINITIONS: readonly {
	readonly key: MailTabKey;
	readonly label: string;
	readonly counted: boolean;
}[] = [
	{ key: "view", label: "View", counted: false },
	{ key: "articles", label: "Extracted Articles", counted: true },
	{ key: "excluded", label: "Skipped", counted: true },
];

/** How many items each list tab holds, for the `(N)` suffix. A key is absent
 * while its count is still unknown — extraction has not written its meta
 * barrier — so the tab renders its bare label rather than claiming a total the
 * panel can't back yet. `view` renders the email itself and never counts. */
export type MailTabCounts = { readonly [K in MailTabKey]?: number };

export interface MailTab {
	key: MailTabKey;
	label: string;
	widestLabel: string;
	href: string;
	ariaCurrent: "page" | undefined;
}

export function buildMailTabs(input: {
	emailId: string;
	active: MailTabKey;
	counts: MailTabCounts;
}): MailTab[] {
	return MAIL_TAB_DEFINITIONS.map(({ key, label, counted }) => {
		const count = input.counts[key];
		return {
			key,
			label: count === undefined ? label : formatTabCountLabel({ label, count }),
			widestLabel: counted
				? formatTabCountLabel({ label, count: Number.MAX_SAFE_INTEGER })
				: label,
			href: withInternalTracking(
				buildInboxEmailDetailUrl({ emailId: input.emailId, tab: key }),
				{ source: "inbox-mail-tabs", content: key },
			),
			ariaCurrent: key === input.active ? "page" : undefined,
		};
	});
}
