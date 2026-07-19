import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderToast } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { renderInboxArticlesPanel } from "./inbox-articles-panel.component";
import { renderInboxExcludedPanel } from "./inbox-excluded-panel.component";
import type { MailTabKey } from "./inbox-email-detail.url";
import { buildInboxEmailIframeSrcdoc } from "./inbox-email-iframe-srcdoc";
import { renderInboxLinkCount } from "./inbox-link-count.component";
import { renderInboxMailTabs } from "./inbox-mail-tabs.component";
import { INBOX_EMAIL_DETAIL_STYLES } from "./inbox-email-detail.styles";
import type { InboxEmailDetailViewModel } from "./inbox-email-detail.viewmodel";

const INBOX_EMAIL_DETAIL_TEMPLATE = readFileSync(
	join(__dirname, "inbox-email-detail.template.html"),
	"utf-8",
);

const INBOX_EMAIL_VIEW_PANEL_TEMPLATE = readFileSync(
	join(__dirname, "inbox-email-view-panel.template.html"),
	"utf-8",
);

function renderViewPanel(vm: InboxEmailDetailViewModel): string {
	return render(INBOX_EMAIL_VIEW_PANEL_TEMPLATE, {
		canRenderBody: vm.canRenderBody,
		unavailableMessage: vm.unavailableMessage,
		viewSrcdoc: vm.canRenderBody
			? buildInboxEmailIframeSrcdoc({
					bodyHtml: vm.bodyHtml,
					imagesCdnBaseUrl: vm.imagesCdnBaseUrl,
				})
			: "",
	});
}

const PANEL_RENDERERS: Record<MailTabKey, (vm: InboxEmailDetailViewModel) => string> = {
	view: renderViewPanel,
	articles: (vm) => renderInboxArticlesPanel(vm.articles),
	excluded: (vm) => renderInboxExcludedPanel(vm.excluded),
};

/** Long enough to read the confirmation after a save or a report, short enough
 * not to sit over the card list. Matches the queue's status toast. */
const STATUS_TOAST_DISMISS_MS = 6000;

export function InboxEmailDetailPage(vm: InboxEmailDetailViewModel): PageBody {
	const panelHtml = PANEL_RENDERERS[vm.activeTab](vm);
	const linkCountHtml = renderInboxLinkCount({ label: vm.linkCountLabel, oob: false });
	const tabsHtml = renderInboxMailTabs({ tabs: vm.tabs, oob: false });
	// No actions: the inbox has no unsave or undo-report route to offer.
	const statusToastHtml =
		vm.statusToastMessage === undefined
			? ""
			: renderToast({
					message: vm.statusToastMessage,
					dismissMs: STATUS_TOAST_DISMISS_MS,
					actions: [],
				});
	return {
		seo: {
			title: "Email — Readplace",
			description: "A newsletter forwarded to your Readplace inbox.",
			canonicalUrl: "/inbox",
			// Personal data: never index a user's received mail.
			robots: "noindex, nofollow",
		},
		styles: INBOX_EMAIL_DETAIL_STYLES,
		bodyClass: "page-inbox",
		content: {
			html: render(INBOX_EMAIL_DETAIL_TEMPLATE, {
				...vm,
				panelHtml,
				linkCountHtml,
				tabsHtml,
				statusToastHtml,
			}),
		},
	};
}
