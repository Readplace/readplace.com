import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { ExcludedLinkViewModel } from "./inbox-excluded-link.viewmodel";
import type { SaveButtonState } from "./inbox-save-button.viewmodel";

const INBOX_EXCLUDED_LINK_TEMPLATE = readFileSync(
	join(__dirname, "inbox-excluded-link.template.html"),
	"utf-8",
);

const SAVE_STATE_CLASSES: Record<SaveButtonState, string> = {
	saved: " inbox-excluded-link__save-button--saved",
	saving: " inbox-excluded-link__save-button--saving",
	unsaved: "",
};

interface InboxExcludedLinkDisplayModel extends ExcludedLinkViewModel {
	saveStateClass: string;
}

function toDisplayModel(vm: ExcludedLinkViewModel): InboxExcludedLinkDisplayModel {
	return {
		...vm,
		saveStateClass: SAVE_STATE_CLASSES[vm.saveButton.saveState],
	};
}

export function renderInboxExcludedLink(vm: ExcludedLinkViewModel): string {
	return render(INBOX_EXCLUDED_LINK_TEMPLATE, toDisplayModel(vm));
}
