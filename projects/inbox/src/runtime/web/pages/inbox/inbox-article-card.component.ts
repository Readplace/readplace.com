import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { InboxCardAction, InboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import type { SaveButtonState } from "./inbox-save-button.viewmodel";

const INBOX_ARTICLE_CARD_TEMPLATE = readFileSync(
	join(__dirname, "inbox-article-card.template.html"),
	"utf-8",
);

const SAVE_STATE_CLASSES: Record<SaveButtonState, string> = {
	saved: " inbox-article-card__action-button--saved",
	saving: " inbox-article-card__action-button--saving",
	unsaved: "",
};

interface InboxArticleCardActionDisplayModel extends InboxCardAction {
	saveStateClass: string;
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
			saveStateClass: action.saveState === undefined ? "" : SAVE_STATE_CLASSES[action.saveState],
		})),
	};
}

export function renderInboxArticleCard(vm: InboxLinkCardViewModel): string {
	return render(INBOX_ARTICLE_CARD_TEMPLATE, toDisplayModel(vm));
}
