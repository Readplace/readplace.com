import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderInFlightDots } from "@packages/web-shell";
import type { ExcludedLinkViewModel } from "./inbox-excluded-link.viewmodel";
import type { InboxCardSaveAction } from "./inbox-link-card.viewmodel";
import {
	type SaveButtonLabelReserves,
	type SaveButtonState,
	saveButtonLabelReserves,
} from "./inbox-save-button.viewmodel";

const INBOX_EXCLUDED_LINK_TEMPLATE = readFileSync(
	join(__dirname, "inbox-excluded-link.template.html"),
	"utf-8",
);

const SAVE_BUTTON_CLASSES: Record<SaveButtonState, string> = {
	unsaved: "btn btn--toggle btn--compact",
	saving: "btn btn--toggle btn--compact inbox-excluded-link__save-button--saving",
	saved: "btn btn--toggle btn--compact inbox-excluded-link__save-button--saved",
};

const SAVE_LOADER_HTML = renderInFlightDots("inbox-excluded-link__save-loader in-flight-dots");

interface InboxExcludedLinkActionDisplayModel extends InboxCardSaveAction, SaveButtonLabelReserves {
	buttonClass: string;
	loaderHtml: string;
}

interface InboxExcludedLinkDisplayModel extends Omit<ExcludedLinkViewModel, "actions"> {
	actions: InboxExcludedLinkActionDisplayModel[];
}

function toDisplayModel(vm: ExcludedLinkViewModel): InboxExcludedLinkDisplayModel {
	return {
		...vm,
		actions: vm.actions.map((action) => ({
			...action,
			...saveButtonLabelReserves(action.saveState),
			buttonClass: `${SAVE_BUTTON_CLASSES[action.saveState]} inbox-excluded-link__save-button`,
			loaderHtml: SAVE_LOADER_HTML,
		})),
	};
}

export function renderInboxExcludedLink(vm: ExcludedLinkViewModel): string {
	return render(INBOX_EXCLUDED_LINK_TEMPLATE, toDisplayModel(vm));
}
