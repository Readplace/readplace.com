import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { MailTab } from "./mail-tabs";

const INBOX_MAIL_TABS_TEMPLATE = readFileSync(
	join(__dirname, "inbox-mail-tabs.template.html"),
	"utf-8",
);

/**
 * The tab strip, rendered as a stable `id`'d element so the panel poll can keep
 * its `(N)` counts in lockstep with the panel. The full page renders it inline
 * (`oob: false`); the poll routes re-emit it with `oob: true` so an htmx
 * out-of-band swap fills the counts in the instant extraction completes, instead
 * of leaving them withheld until a full reload.
 */
export function renderInboxMailTabs(input: { tabs: MailTab[]; oob: boolean }): string {
	return render(INBOX_MAIL_TABS_TEMPLATE, { tabs: input.tabs, oob: input.oob });
}
