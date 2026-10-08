import { render } from "../../render";
import type { IconName } from "@packages/ui-icons";
import { CONFIRM_POPOVER_TEMPLATE } from "./confirm-popover.template";

/** A caller that renders the panel must also ship its stylesheet — a page that
 * takes one without the other gets an unstyled block sitting in the flow — so
 * both leave through this module rather than being two imports to remember. */
export { CONFIRM_POPOVER_STYLES } from "./confirm-popover.styles";

export interface ConfirmPopover {
	id: string;
	/** Names the kind of decision, for the panel and its dismiss control alike. */
	key: string;
	/** What this particular panel decides about, when a page carries one panel
	 * per row and the key alone cannot tell them apart. */
	subject?: string;
	title: string;
	body: string;
	bodyItems?: readonly { label: string; icon: IconName }[];
	lead?: string;
	openBeaconUrl?: string;
	close?: { beaconUrl?: string };
	illustrationHtml?: string;
	/** One .confirm-popover__actions element; forms with only buttons also use .confirm-popover__buttons, with dismiss before commit. */
	actionsHtml: string;
}

function describedFields(popover: ConfirmPopover) {
	const lead = popover.lead;
	const hasItems = popover.bodyItems !== undefined;
	return {
		closeControls: popover.close === undefined ? [] : [{ beaconUrl: popover.close.beaconUrl }],
		describedBy: [
			...(lead === undefined ? [] : [`${popover.id}-lead`]),
			`${popover.id}-body`,
			...(hasItems ? [`${popover.id}-items`] : []),
		].join(" "),
	};
}

export function renderConfirmPopover(popover: ConfirmPopover): string {
	return render(CONFIRM_POPOVER_TEMPLATE, { ...popover, ...describedFields(popover) });
}
