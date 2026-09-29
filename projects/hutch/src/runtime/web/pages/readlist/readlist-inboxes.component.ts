import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	INBOX_ADDRESSES_PATH,
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
		submitLabel: `Send to ${DEFAULT_READLIST_LABEL}`,
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
		`Newsletters sent to these inboxes are saved to ${label} instead of ${DEFAULT_READLIST_LABEL}.`,
	set: (label) =>
		`Newsletters sent to these inboxes are saved to ${label} instead of ${DEFAULT_READLIST_LABEL}, keeping only the links that fit its purpose.`,
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
			const destinationLabel =
				input.readlists.find((readlist) => readlist.slug === inbox.readlist)?.label ??
				DEFAULT_READLIST_LABEL;
			return {
				nameId: `readlist-inbox-${index}-name`,
				name: inbox.name,
				address: inbox.address,
				destinationText: `Goes to ${destinationLabel}`,
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
		createInboxHref: withInternalTracking(INBOX_ADDRESSES_PATH, {
			source: INBOXES_SOURCE,
			content: "create-inbox",
		}),
	};
}

export function renderReadlistInboxes(displayModel: ReadlistInboxesDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
