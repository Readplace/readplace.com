import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { InboxEmailLinkEntry } from "@packages/domain/inbox";

const INBOX_LIVE_STATUS_TEMPLATE = readFileSync(
	join(__dirname, "inbox-live-status.template.html"),
	"utf-8",
);

/**
 * The detail page's one live region. The full page renders it empty and inline
 * (`oob: false`); a poll that finds a card resolved re-emits it with `oob: true`
 * so htmx writes the announcement into the region already on the page.
 *
 * The out-of-band swap is `innerHTML`, not the `outerHTML` the link count and
 * tab strip use: replacing a live region's own element removes the node the
 * screen reader is watching, and the replacement is not reliably announced.
 * Only the text inside it may change.
 */
export function renderInboxLiveStatus(input: { message: string; oob: boolean }): string {
	return render(INBOX_LIVE_STATUS_TEMPLATE, { message: input.message, oob: input.oob });
}

/**
 * What the region says once a card's crawl lands. Empty while the link is still
 * pending, which is what keeps a poll tick that changed nothing silent — a live
 * region re-announces whatever text it is given, so an unchanged card must
 * write nothing rather than write the same sentence every three seconds.
 */
export function buildCardResolvedAnnouncement(input: {
	status: InboxEmailLinkEntry["status"];
	title: string;
	url: string;
}): string {
	if (input.status === "failed") return `No preview available for ${input.url}`;
	if (input.status !== "crawled") return "";
	return input.title === "" ? `Preview ready for ${input.url}` : `Preview ready: ${input.title}`;
}
