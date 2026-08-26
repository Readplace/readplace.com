import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { InboxCardAction, InboxLinkCardViewModel } from "./inbox-link-card.viewmodel";
import type { SaveButtonState } from "./inbox-save-button.viewmodel";

const INBOX_ARTICLE_CARD_TEMPLATE = readFileSync(
	join(__dirname, "inbox-article-card.template.html"),
	"utf-8",
);

type ActionEmphasis = SaveButtonState | "supporting";

const ACTION_BUTTON_CLASSES: Record<ActionEmphasis, string> = {
	unsaved: "btn btn--primary btn--compact",
	saving: "btn btn--primary btn--compact inbox-article-card__action-button--saving",
	saved: "btn btn--secondary btn--compact inbox-article-card__action-button--saved",
	supporting: "btn btn--secondary btn--compact",
};

interface InboxArticleCardActionDisplayModel extends InboxCardAction {
	buttonClass: string;
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
			buttonClass: `${ACTION_BUTTON_CLASSES[action.saveState ?? "supporting"]} inbox-article-card__action-button`,
		})),
	};
}

export function renderInboxArticleCard(vm: InboxLinkCardViewModel): string {
	return render(INBOX_ARTICLE_CARD_TEMPLATE, toDisplayModel(vm));
}
