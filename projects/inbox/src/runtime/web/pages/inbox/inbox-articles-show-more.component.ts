import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { ArticleShowMore } from "./inbox-email-detail.viewmodel";

const INBOX_ARTICLES_SHOW_MORE_TEMPLATE = readFileSync(
	join(__dirname, "inbox-articles-show-more.template.html"),
	"utf-8",
);

export function renderInboxShowMore(vm: ArticleShowMore): string {
	return render(INBOX_ARTICLES_SHOW_MORE_TEMPLATE, vm);
}
