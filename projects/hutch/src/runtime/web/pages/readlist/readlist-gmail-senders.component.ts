import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderInFlightDots } from "@packages/web-shell";
import { renderGmailConnectDisclaimer } from "../integrations/gmail-connect-disclaimer.component";
import { renderGmailSenderSelectionHtml } from "../integrations/gmail-sender-widget.component";
import { READLIST_GMAIL_SECTION_ID } from "./readlist-gmail-senders.url";
import type { ReadlistGmailSendersViewModel } from "./readlist-gmail-senders.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "readlist-gmail-senders.template.html"), "utf-8");

export const READLIST_GMAIL_SENDERS_STYLES = readFileSync(join(__dirname, "readlist-gmail-senders.styles.css"), "utf-8");

const SAVE_LOADER_HTML = renderInFlightDots("gmail__submit-loader in-flight-dots");

export function renderReadlistGmailSenders(vm: ReadlistGmailSendersViewModel): string {
	return render(TEMPLATE, {
		sectionId: READLIST_GMAIL_SECTION_ID,
		sectionClass: vm.sectionClass,
		state: vm.state,
		lede: vm.lede,
		notes: vm.notes,
		prompts: vm.prompt === undefined ? [] : [vm.prompt],
		connects: vm.connect === undefined
			? []
			: [{
				label: vm.connect.label,
				popoverId: vm.connect.disclaimer.confirmPopoverId,
				disclaimerHtml: renderGmailConnectDisclaimer(vm.connect.disclaimer),
			}],
		pickers: vm.picker === undefined
			? []
			: [{
				pagePath: vm.picker.pagePath,
				selectionFields: vm.picker.selectionFields,
				saveAction: vm.picker.saveAction,
				saveLoader: SAVE_LOADER_HTML,
				widgetHtml: renderGmailSenderSelectionHtml(vm.picker),
			}],
		links: vm.links,
	});
}
