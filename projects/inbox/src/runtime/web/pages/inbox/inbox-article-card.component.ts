import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderInFlightDots } from "@packages/web-shell";
import type {
	CardStatusState,
	InboxCardSaveAction,
	InboxLinkCardViewModel,
} from "./inbox-link-card.viewmodel";
import {
	type SaveButtonLabelReserves,
	type SaveButtonState,
	saveButtonLabelReserves,
} from "./inbox-save-button.viewmodel";

const INBOX_ARTICLE_CARD_TEMPLATE = readFileSync(
	join(__dirname, "inbox-article-card.template.html"),
	"utf-8",
);

const ACTION_BUTTON_CLASSES: Record<SaveButtonState, string> = {
	unsaved: "btn btn--toggle btn--compact",
	saving: "btn btn--toggle btn--compact inbox-article-card__action-button--saving",
	saved: "btn btn--toggle btn--compact inbox-article-card__action-button--saved",
};

const CARD_STATUS_DISPLAY: Record<
	CardStatusState,
	{ statusClass: string; statusIconName: "loader" | undefined }
> = {
	working: {
		statusClass: "inbox-article-card__status inbox-article-card__status--working",
		statusIconName: "loader",
	},
	stalled: {
		statusClass: "inbox-article-card__status inbox-article-card__status--stalled",
		statusIconName: undefined,
	},
	failed: {
		statusClass: "inbox-article-card__status inbox-article-card__status--failed",
		statusIconName: undefined,
	},
	none: {
		statusClass: "inbox-article-card__status inbox-article-card__status--none",
		statusIconName: undefined,
	},
};

const SAVE_LOADER_HTML = renderInFlightDots("inbox-article-card__action-loader in-flight-dots");

interface InboxArticleCardActionDisplayModel extends InboxCardSaveAction, SaveButtonLabelReserves {
	buttonClass: string;
	loaderHtml: string;
}

interface InboxArticleCardDisplayModel extends Omit<InboxLinkCardViewModel, "actions"> {
	cardStatus: "pending" | "terminal";
	statusClass: string;
	statusIconName: "loader" | undefined;
	menuSubject: string;
	actions: InboxArticleCardActionDisplayModel[];
}

function toDisplayModel(vm: InboxLinkCardViewModel): InboxArticleCardDisplayModel {
	return {
		...vm,
		...CARD_STATUS_DISPLAY[vm.statusState],
		cardStatus: vm.cardPollUrl === undefined ? "terminal" : "pending",
		menuSubject: vm.hasTitle ? vm.title : vm.url,
		actions: vm.actions.map((action) => ({
			...action,
			...saveButtonLabelReserves(action.saveState),
			buttonClass: `${ACTION_BUTTON_CLASSES[action.saveState]} inbox-article-card__action-button`,
			loaderHtml: SAVE_LOADER_HTML,
		})),
	};
}

export function renderInboxArticleCard(vm: InboxLinkCardViewModel): string {
	return render(INBOX_ARTICLE_CARD_TEMPLATE, toDisplayModel(vm));
}
