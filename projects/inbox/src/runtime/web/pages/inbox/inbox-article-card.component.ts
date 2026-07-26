import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { InboxCardAction, InboxLinkCardViewModel } from "./inbox-link-card.viewmodel";

const INBOX_ARTICLE_CARD_TEMPLATE = readFileSync(
	join(__dirname, "inbox-article-card.template.html"),
	"utf-8",
);

interface InboxArticleCardActionDisplayModel extends InboxCardAction {
	savedClass: string;
}

interface InboxArticleCardDisplayModel extends Omit<InboxLinkCardViewModel, "actions"> {
	cardStatus: "pending" | "terminal";
	actions: InboxArticleCardActionDisplayModel[];
}

function toDisplayModel(vm: InboxLinkCardViewModel): InboxArticleCardDisplayModel {
	return {
		...vm,
		cardStatus: vm.cardPollUrl === undefined ? "terminal" : "pending",
		actions: vm.actions.map((action) => ({
			...action,
			savedClass:
				action.saveState === "saved" ? " inbox-article-card__action-button--saved" : "",
		})),
	};
}

export function renderInboxArticleCard(vm: InboxLinkCardViewModel): string {
	return render(INBOX_ARTICLE_CARD_TEMPLATE, toDisplayModel(vm));
}
