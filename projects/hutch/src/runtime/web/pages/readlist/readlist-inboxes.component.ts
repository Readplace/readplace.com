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
import { type UpgradeOffer, type UpgradeStanding, renderedLockFor } from "../../shared/upgrade-offer/upgrade-offer";
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
	editable: boolean;
	lockedNotes: readonly string[];
	locks: readonly string[];
}

interface InboxesLocking {
	editable: boolean;
	lockedNotes: readonly string[];
	locks: readonly string[];
}

const LOCKING: Record<UpgradeStanding, (offer: UpgradeOffer | undefined) => InboxesLocking> = {
	open: () => ({ editable: true, lockedNotes: [], locks: [] }),
	"needs-upgrade": (offer) => ({
		editable: false,
		lockedNotes: [t("readlistInboxes.locked.note")],
		locks: renderedLockFor({
			offer,
			gated: true,
			key: "create-inbox",
			label: t("readlistInboxes.create.submit"),
			controlClass: "btn btn--neutral btn--m",
			source: INBOXES_SOURCE,
		}),
	}),
	withheld: () => ({ editable: false, lockedNotes: [t("readlistInboxes.locked.note")], locks: [] }),
};

export function buildReadlistInboxes(input: {
	readlist: { slug: ReadlistSlug; label: string };
	inboxes: readonly InboxAddressEntry[];
	readlists: readonly ReadlistRef[];
	create: { submittedName: string | undefined; error: InboxNameError | undefined };
	standing: UpgradeStanding;
	offer: UpgradeOffer | undefined;
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
	return {
		sectionId: READLIST_INBOXES_SECTION_ID,
		sectionClass: SECTION_CLASS[state],
		state,
		descriptionLines: [
			`Send a custom email here and every article each email links to is saved to '${DEFAULT_READLIST_LABEL}' and '${input.readlist.label}'.`,
		],
		deliveryLabel: "The articles it links to",
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
		...LOCKING[input.standing](input.offer),
	};
}

export function renderReadlistInboxes(displayModel: ReadlistInboxesDisplayModel): string {
	return render(TEMPLATE, displayModel);
}
