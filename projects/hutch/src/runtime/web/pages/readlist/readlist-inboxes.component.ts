import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CUSTOM_EMAILS_PATH,
	type InboxAddressEntry,
	isCappedAddress,
	isLiveAddress,
} from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_LABEL,
	DEFAULT_READLIST_SLUG,
	type ReadlistRef,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import { render, withInternalTracking } from "@packages/web-shell";

import { preferencesInboxesUrl } from "./readlist-preferences-feature";

const TEMPLATE = readFileSync(join(__dirname, "readlist-inboxes.template.html"), "utf-8");

const INBOXES_SOURCE = "queue-preferences";

type InboxesState = "empty" | "listed";

const SECTION_CLASS: Record<InboxesState, string> = {
	empty: "readlist-inboxes--empty",
	listed: "readlist-inboxes--listed",
};

type InboxRouting = "here" | "elsewhere";

const ROUTING_ACTIONS: Record<
	InboxRouting,
	{
		submitLabel: string;
		trackingContent: string;
		destination: (readlist: ReadlistSlug) => ReadlistSlug;
	}
> = {
	here: {
		submitLabel: `Send to ${DEFAULT_READLIST_LABEL} only`,
		trackingContent: "unroute-inbox",
		destination: () => DEFAULT_READLIST_SLUG,
	},
	elsewhere: {
		submitLabel: "Send here",
		trackingContent: "route-inbox",
		destination: (readlist) => readlist,
	},
};

const DESCRIPTIONS: Record<"unset" | "set", (label: string) => string> = {
	unset: (label) =>
		`Send a custom email here and the articles each issue links to are saved to ${DEFAULT_READLIST_LABEL} and ${label}.`,
	set: (label) =>
		`Send a custom email here and every article each issue links to is saved to ${DEFAULT_READLIST_LABEL}. The ones that fit are also saved to ${label}.`,
};

export interface ReadlistInboxRow {
	nameId: string;
	name: string;
	address: string;
	destinationText: string;
	routing: InboxRouting;
	action: string;
	destination: ReadlistSlug;
	submitLabel: string;
	testAction: string;
}

export interface ReadlistInboxesDisplayModel {
	sectionClass: string;
	state: InboxesState;
	description: string;
	rows: readonly ReadlistInboxRow[];
	createInboxHref: string;
}

export function buildReadlistInboxes(input: {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	inboxes: readonly InboxAddressEntry[];
	readlists: readonly ReadlistRef[];
	preferencesEnabled: boolean;
}): ReadlistInboxesDisplayModel {
	const action = preferencesInboxesUrl({
		slug: input.readlist.slug,
		enabled: input.preferencesEnabled,
	});
	const rows = input.inboxes
		.filter((inbox) => isLiveAddress(inbox) && isCappedAddress(inbox))
		.sort(
			(left, right) =>
				left.name.localeCompare(right.name) || left.address.localeCompare(right.address),
		)
		.map((inbox, index): ReadlistInboxRow => {
			const routing: InboxRouting = inbox.readlist === input.readlist.slug ? "here" : "elsewhere";
			const routingAction = ROUTING_ACTIONS[routing];
			const routedTo = input.readlists.find((readlist) => readlist.slug === inbox.readlist);
			return {
				nameId: `readlist-inbox-${index}-name`,
				name: inbox.name,
				address: inbox.address,
				destinationText:
					routedTo === undefined
						? `Saves to ${DEFAULT_READLIST_LABEL}`
						: `Saves to ${DEFAULT_READLIST_LABEL} and ${routedTo.label}`,
				routing,
				action: withInternalTracking(action, {
					source: INBOXES_SOURCE,
					content: routingAction.trackingContent,
				}),
				destination: routingAction.destination(input.readlist.slug),
				submitLabel: routingAction.submitLabel,
				testAction: routingAction.trackingContent,
			};
		});
	const state: InboxesState = rows.length === 0 ? "empty" : "listed";
	return {
		sectionClass: SECTION_CLASS[state],
		state,
		description: DESCRIPTIONS[input.readlist.purpose === undefined ? "unset" : "set"](
			input.readlist.label,
		),
		rows,
		createInboxHref: withInternalTracking(CUSTOM_EMAILS_PATH, {
			source: INBOXES_SOURCE,
			content: "create-inbox",
		}),
	};
}

export function renderReadlistInboxes(displayModel: ReadlistInboxesDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
