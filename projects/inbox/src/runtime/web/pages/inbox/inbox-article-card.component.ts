import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { InboxLinkCardViewModel } from "./inbox-link-card.viewmodel";

const INBOX_ARTICLE_CARD_TEMPLATE = readFileSync(
	join(__dirname, "inbox-article-card.template.html"),
	"utf-8",
);

interface InboxArticleCardDisplayModel extends InboxLinkCardViewModel {
	isCrawled: boolean;
	isFailed: boolean;
	cardStatus: "pending" | "terminal";
}

function toDisplayModel(vm: InboxLinkCardViewModel): InboxArticleCardDisplayModel {
	return {
		...vm,
		isCrawled: vm.status === "crawled",
		isFailed: vm.status === "failed",
		cardStatus: vm.cardPollUrl === undefined ? "terminal" : "pending",
	};
}

export function renderInboxArticleCard(vm: InboxLinkCardViewModel): string {
	return render(INBOX_ARTICLE_CARD_TEMPLATE, toDisplayModel(vm));
}
