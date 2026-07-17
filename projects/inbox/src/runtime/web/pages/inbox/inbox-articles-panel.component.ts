import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { renderInboxArticleCard } from "./inbox-article-card.component";
import { renderInboxShowMore } from "./inbox-articles-show-more.component";
import { renderInboxExcludedLink } from "./inbox-excluded-link.component";
import type { ArticlesPanelViewModel } from "./inbox-email-detail.viewmodel";

const INBOX_ARTICLES_PANEL_TEMPLATE = readFileSync(
	join(__dirname, "inbox-articles-panel.template.html"),
	"utf-8",
);

/**
 * Renders the Articles panel as a standalone `<section>` so the same markup
 * serves both the full detail page and the `GET /inbox/:id/articles` poll
 * fragment, which swaps it in place via htmx `outerHTML` until extraction
 * completes. `data-articles-status` makes the state assertable in tests.
 */
export function renderInboxArticlesPanel(vm: ArticlesPanelViewModel): string {
	return render(INBOX_ARTICLES_PANEL_TEMPLATE, {
		...vm,
		articleHtmls: vm.cards.map(renderInboxArticleCard),
		excludedHtmls: vm.excluded.map(renderInboxExcludedLink),
		hasCards: vm.cards.length > 0,
		hasExcluded: vm.excluded.length > 0,
		showMoreHtml: vm.showMore === undefined ? "" : renderInboxShowMore(vm.showMore),
		panelStatus: vm.isExtracting ? "extracting" : vm.isStalePending ? "stale" : "terminal",
	});
}
