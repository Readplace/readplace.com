import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { ExcludedLinkViewModel } from "./inbox-excluded-link.viewmodel";
import type { SaveButtonState } from "./inbox-save-button.viewmodel";

const INBOX_EXCLUDED_LINK_TEMPLATE = readFileSync(
	join(__dirname, "inbox-excluded-link.template.html"),
	"utf-8",
);

const SAVE_BUTTON_CLASSES: Record<SaveButtonState, string> = {
	unsaved: "btn btn--primary btn--compact",
	saving: "btn btn--primary btn--compact inbox-excluded-link__save-button--saving",
	saved: "btn btn--secondary btn--compact inbox-excluded-link__save-button--saved",
};

interface InboxExcludedLinkDisplayModel extends ExcludedLinkViewModel {
	buttonClass: string;
}

function toDisplayModel(vm: ExcludedLinkViewModel): InboxExcludedLinkDisplayModel {
	return {
		...vm,
		buttonClass: `${SAVE_BUTTON_CLASSES[vm.saveButton.saveState]} inbox-excluded-link__save-button`,
	};
}

export function renderInboxExcludedLink(vm: ExcludedLinkViewModel): string {
	return render(INBOX_EXCLUDED_LINK_TEMPLATE, toDisplayModel(vm));
}
