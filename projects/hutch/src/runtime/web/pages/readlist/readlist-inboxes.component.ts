import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CUSTOM_EMAILS_PATH,
	type InboxAddressEntry,
	isCappedAddress,
	isLiveAddress,
	normalizeAliasName,
} from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_LABEL,
	type ReadlistRef,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
import { render, withInternalTracking } from "@packages/web-shell";
import { type PurposeState, purposeStateOf } from "./readlist-purpose-card.component";
import { readlistPreferencesInboxesCreatePath, readlistPreferencesInboxesPath } from "./readlist.url";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

const TEMPLATE = readFileSync(join(__dirname, "readlist-inboxes.template.html"), "utf-8");

export const READLIST_INBOXES_SECTION_ID = "readlist-inboxes";

const INBOXES_SOURCE = "queue-preferences";

type InboxesState = "empty" | "listed";

const SECTION_CLASS: Record<InboxesState, string> = {
	empty: "readlist-inboxes--empty",
	listed: "readlist-inboxes--listed",
};

export type InboxNameError = "invalid-name" | "name-taken";

const NAME_ERRORS: Record<InboxNameError, string> = {
	"invalid-name": t("readlistInboxes.create.errors.invalidName"),
	"name-taken": t("readlistInboxes.create.errors.nameTaken"),
};

type InboxRouting = "here" | "elsewhere";

const ROUTING_TRACKING: Record<InboxRouting, string> = {
	here: "unroute-inbox",
	elsewhere: "route-inbox",
};

const DESCRIPTION_LINES: Record<PurposeState, (label: string) => readonly string[]> = {
	unset: (label) => [
		`Send a custom email here and every article each email links to is saved to '${DEFAULT_READLIST_LABEL}' and '${label}'.`,
	],
	set: (label) => [
		`Send a custom email here and every article each email links to is saved to '${DEFAULT_READLIST_LABEL}'.`,
		`Only the ones who match your preferences will be saved to '${label}'`,
	],
};

const DELIVERY_LABELS: Record<PurposeState, string> = {
	unset: "The articles it links to",
	set: "The articles it links to that matches this readlist preferences",
};

export interface ReadlistInboxRow {
	nameId: string;
	name: string;
	address: string;
	destinationText: string;
	routing: InboxRouting;
	routedHere: boolean;
	action: string;
	testAction: string;
}

export interface ReadlistInboxesDisplayModel {
	sectionId: string;
	sectionClass: string;
	state: InboxesState;
	descriptionLines: readonly string[];
	deliveryLabel: string;
	rows: readonly ReadlistInboxRow[];
	createAction: string;
	createValue: string;
	createError: string | undefined;
	manageInboxesHref: string;
}

export function buildReadlistInboxes(input: {
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	inboxes: readonly InboxAddressEntry[];
	readlists: readonly ReadlistRef[];
	create: { submittedName: string | undefined; error: InboxNameError | undefined };
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
			const trackingContent = ROUTING_TRACKING[routing];
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
				routedHere: routing === "here",
				action: withInternalTracking(action, {
					source: INBOXES_SOURCE,
					content: trackingContent,
				}),
				testAction: trackingContent,
			};
		});
	const state: InboxesState = rows.length === 0 ? "empty" : "listed";
	const purposeState = purposeStateOf(input.readlist);
	return {
		sectionId: READLIST_INBOXES_SECTION_ID,
		sectionClass: SECTION_CLASS[state],
		state,
		descriptionLines: DESCRIPTION_LINES[purposeState](input.readlist.label),
		deliveryLabel: DELIVERY_LABELS[purposeState],
		rows,
		createAction: withInternalTracking(readlistPreferencesInboxesCreatePath(input.readlist.slug), {
			source: INBOXES_SOURCE,
			content: "create-inbox",
		}),
		createValue: input.create.submittedName ?? normalizeAliasName(input.readlist.label) ?? "",
		createError: input.create.error === undefined ? undefined : NAME_ERRORS[input.create.error],
		manageInboxesHref: withInternalTracking(CUSTOM_EMAILS_PATH, {
			source: INBOXES_SOURCE,
			content: "manage-inboxes",
		}),
	};
}

export function renderReadlistInboxes(displayModel: ReadlistInboxesDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
