import { render } from "../../render";
import { CONFIRM_POPOVER_TEMPLATE } from "./confirm-popover.template";

/** A caller that renders the panel must also ship its stylesheet — a page that
 * takes one without the other gets an unstyled block sitting in the flow — so
 * both leave through this module rather than being two imports to remember. */
export { CONFIRM_POPOVER_STYLES } from "./confirm-popover.styles";

export interface ConfirmPopoverLead {
	text: string;
	/** True when the subject is already on screen behind the panel, so repeating
	 * it visibly would be noise while a screen reader still needs it named. */
	screenReaderOnly: boolean;
}

export interface ConfirmPopover {
	id: string;
	/** Names the kind of decision, for the panel and its dismiss control alike. */
	key: string;
	/** What this particular panel decides about, when a page carries one panel
	 * per row and the key alone cannot tell them apart. */
	subject?: string;
	title: string;
	body: string;
	bodyItems?: readonly string[];
	lead?: ConfirmPopoverLead;
	openBeaconUrl?: string;
	dismissBeaconUrl?: string;
	wide?: boolean;
	/** The panel's controls, rendered by the caller: their markup, wording and
	 * button tier belong to the decision, not to the shell. Must be a single
	 * `.confirm-popover__actions` element. */
	actionsHtml: string;
}

function describedFields(popover: ConfirmPopover) {
	const lead = popover.lead;
	const hasItems = popover.bodyItems !== undefined;
	return {
		...(lead === undefined
			? {}
			: {
					lead: {
						text: lead.text,
						cssClass: lead.screenReaderOnly ? "sr-only" : "confirm-popover__lead",
					},
				}),
		describedBy: [
			...(lead === undefined ? [] : [`${popover.id}-lead`]),
			`${popover.id}-body`,
			...(hasItems ? [`${popover.id}-items`] : []),
		].join(" "),
		bodyClass: hasItems
			? "confirm-popover__body confirm-popover__body--above-list"
			: "confirm-popover__body",
	};
}

export function renderConfirmPopover(popover: ConfirmPopover): string {
	return render(CONFIRM_POPOVER_TEMPLATE, { ...popover, ...describedFields(popover) });
}
