import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const INBOX_LINK_COUNT_TEMPLATE = readFileSync(
	join(__dirname, "inbox-link-count.template.html"),
	"utf-8",
);

/**
 * The header "12 links" badge, rendered as a stable `id`'d element so the Articles
 * panel poll can keep it in lockstep with the panel. The full page renders it inline
 * (`oob: false`); the `/inbox/:id/articles` poll re-emits it with `oob: true` so an
 * htmx out-of-band swap refreshes the header the instant extraction completes —
 * otherwise the count would lag the swapped-in card set until a full reload. While
 * extraction is pending the label is `undefined`, so the badge renders empty (hidden
 * via `:empty`) and the header makes no count claim before the panel does.
 */
export function renderInboxLinkCount(input: { label: string | undefined; oob: boolean }): string {
	return render(INBOX_LINK_COUNT_TEMPLATE, { label: input.label, oob: input.oob });
}
