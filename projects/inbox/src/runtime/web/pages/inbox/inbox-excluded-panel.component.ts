import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { renderInboxExcludedLink } from "./inbox-excluded-link.component";
import type { ExcludedPanelViewModel } from "./inbox-email-detail.viewmodel";

const INBOX_EXCLUDED_PANEL_TEMPLATE = readFileSync(
	join(__dirname, "inbox-excluded-panel.template.html"),
	"utf-8",
);

/**
 * Renders the Skipped panel as a standalone `<section>` so the same markup
 * serves both the full detail page and the `GET /inbox/:id/excluded` poll
 * fragment, which swaps it in place via htmx `outerHTML` until extraction
 * completes. It polls for the same reason the Articles panel does: before the
 * extractor writes its meta barrier, "nothing was skipped" is an answer nobody
 * has computed yet. `data-excluded-status` makes the state assertable in tests.
 */
export function renderInboxExcludedPanel(vm: ExcludedPanelViewModel): string {
	return render(INBOX_EXCLUDED_PANEL_TEMPLATE, {
		...vm,
		excludedHtmls: vm.links.map(renderInboxExcludedLink),
		panelStatus: vm.isExtracting ? "extracting" : vm.isStalePending ? "stale" : "terminal",
	});
}
