import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { renderInboxArticleCard } from "./inbox-article-card.component";
import { buildInboxEmailIframeSrcdoc } from "./inbox-email-iframe-srcdoc";
import { INBOX_EMAIL_DETAIL_STYLES } from "./inbox-email-detail.styles";
import type { InboxEmailDetailViewModel } from "./inbox-email-detail.viewmodel";

const INBOX_EMAIL_DETAIL_TEMPLATE = readFileSync(
	join(__dirname, "inbox-email-detail.template.html"),
	"utf-8",
);

export function InboxEmailDetailPage(vm: InboxEmailDetailViewModel): PageBody {
	const viewSrcdoc = vm.canRenderBody
		? buildInboxEmailIframeSrcdoc({ bodyHtml: vm.bodyHtml })
		: "";
	const articleHtmls = vm.articles.cards.map(renderInboxArticleCard);
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
		content: { html: render(INBOX_EMAIL_DETAIL_TEMPLATE, { ...vm, viewSrcdoc, articleHtmls }) },
	};
}
