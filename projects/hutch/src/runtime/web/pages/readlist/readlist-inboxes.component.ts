import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CUSTOM_EMAILS_PATH,
	type EmailDeliveryMode,
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
import { readlistPreferencesEmailDeliveryPath, readlistPreferencesInboxesPath } from "./readlist.url";

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
		submitLabel: (names: { inbox: string; readlist: string }) => string;
		trackingContent: string;
		destination: (readlist: ReadlistSlug) => ReadlistSlug;
	}
> = {
	here: {
		submitLabel: (names) => `Stop sending emails from '${names.inbox}' inbox to this readlist`,
		trackingContent: "unroute-inbox",
		destination: () => DEFAULT_READLIST_SLUG,
	},
	elsewhere: {
		submitLabel: (names) => `Send here ('${names.readlist}' readlist)`,
		trackingContent: "route-inbox",
		destination: (readlist) => readlist,
	},
};

const EMAIL_DELIVERY_COPY: Record<EmailDeliveryMode, { label: string; description: string }> = {
	issue: {
		label: "The email itself",
		description: "Each email lands in your readlist as one article. Save the links you want while you read it.",
	},
	links: {
		label: "The articles it links to",
		description: "The articles each email links to are saved one by one. The email stays on its inbox page.",
	},
	both: {
		label: "Both",
		description: "Each email lands as an article, and the articles it links to are saved beside it.",
	},
};

const EMAIL_DELIVERY_ORDER: readonly EmailDeliveryMode[] = ["issue", "links", "both"];

const DESCRIPTIONS: Record<EmailDeliveryMode, Record<"unset" | "set", (label: string) => string>> = {
	links: {
		unset: (label) =>
			`Send a custom email here and the articles each email links to are saved to ${DEFAULT_READLIST_LABEL} and ${label}.`,
		set: (label) =>
			`Send a custom email here and every article each email links to is saved to ${DEFAULT_READLIST_LABEL}. The ones that fit are also saved to ${label}.`,
	},
	issue: {
		unset: (label) =>
			`Send a custom email here and each email is saved as one article to ${DEFAULT_READLIST_LABEL} and ${label}.`,
		set: (label) =>
			`Send a custom email here and each email is saved as one article to ${DEFAULT_READLIST_LABEL} and ${label}.`,
	},
	both: {
		unset: (label) =>
			`Send a custom email here and each email is saved as one article, with the articles it links to, to ${DEFAULT_READLIST_LABEL} and ${label}.`,
		set: (label) =>
			`Send a custom email here and each email is saved as one article to ${DEFAULT_READLIST_LABEL} and ${label}, and the articles it links to are saved to ${DEFAULT_READLIST_LABEL}, with the ones that fit also saved to ${label}.`,
	},
};

export interface ReadlistEmailDeliveryOption {
	value: EmailDeliveryMode;
	label: string;
	description: string;
	checked: boolean;
}

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
	deliveryAction: string;
	deliveryOptions: readonly ReadlistEmailDeliveryOption[];
	rows: readonly ReadlistInboxRow[];
	createInboxHref: string;
	manageInboxesHref: string;
}

export function buildReadlistInboxes(input: {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string; emailDelivery: EmailDeliveryMode };
	inboxes: readonly InboxAddressEntry[];
	readlists: readonly ReadlistRef[];
}): ReadlistInboxesDisplayModel {
	const action = readlistPreferencesInboxesPath(input.readlist.slug);
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
				submitLabel: routingAction.submitLabel({ inbox: inbox.name, readlist: input.readlist.label }),
				testAction: routingAction.trackingContent,
			};
		});
	const state: InboxesState = rows.length === 0 ? "empty" : "listed";
	return {
		sectionClass: SECTION_CLASS[state],
		state,
		description: DESCRIPTIONS[input.readlist.emailDelivery][input.readlist.purpose === undefined ? "unset" : "set"](
			input.readlist.label,
		),
		deliveryAction: withInternalTracking(readlistPreferencesEmailDeliveryPath(input.readlist.slug), {
			source: INBOXES_SOURCE,
			content: "set-email-delivery",
		}),
		deliveryOptions: EMAIL_DELIVERY_ORDER.map((value) => ({
			value,
			...EMAIL_DELIVERY_COPY[value],
			checked: value === input.readlist.emailDelivery,
		})),
		rows,
		createInboxHref: withInternalTracking(CUSTOM_EMAILS_PATH, {
			source: INBOXES_SOURCE,
			content: "create-inbox",
		}),
		manageInboxesHref: withInternalTracking(CUSTOM_EMAILS_PATH, {
			source: INBOXES_SOURCE,
			content: "manage-inboxes",
		}),
	};
}

export function renderReadlistInboxes(displayModel: ReadlistInboxesDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
