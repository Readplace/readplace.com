import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../../page-body.types";
import { render } from "../../render";
import { NEWSLETTER_STYLES } from "./newsletter.styles";
import type {
	NewsletterDetailViewModel,
	NewsletterListViewModel,
} from "./newsletter.viewmodel";

const LIST_TEMPLATE = readFileSync(join(__dirname, "newsletter.list.template.html"), "utf-8");
const DETAIL_TEMPLATE = readFileSync(join(__dirname, "newsletter.detail.template.html"), "utf-8");

export function NewsletterListPage(vm: NewsletterListViewModel): PageBody {
	return {
		seo: {
			title: "Newsletter inbox — Readplace",
			description: "Subscribe newsletters to your private Readplace address and read every issue in your queue.",
			canonicalUrl: "/newsletter",
			robots: "noindex, nofollow",
		},
		styles: NEWSLETTER_STYLES,
		bodyClass: "page-newsletter",
		content: { html: render(LIST_TEMPLATE, vm) },
	};
}

export function NewsletterDetailPage(vm: NewsletterDetailViewModel): PageBody {
	return {
		seo: {
			title: `${vm.subject} — Readplace`,
			description: "A newsletter received in your Readplace inbox.",
			canonicalUrl: "/newsletter",
			robots: "noindex, nofollow",
		},
		styles: NEWSLETTER_STYLES,
		bodyClass: "page-newsletter",
		content: { html: render(DETAIL_TEMPLATE, vm) },
	};
}
