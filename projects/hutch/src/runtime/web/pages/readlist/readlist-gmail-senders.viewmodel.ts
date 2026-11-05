import assert from "node:assert";
import {
	type DiscoveredGmailSender,
	type ForwardableSender,
	type GmailConnection,
	type GmailConnectionState,
	type GmailDiscovery,
	type GmailMapping,
	type GmailSenderRouting,
	gmailConnectionState,
	pickerDeliveryMode,
} from "@packages/domain/gmail";
import type { InboxAddressEntry } from "@packages/domain/inbox";
import type { NewsletterDetection } from "@packages/domain/newsletter-catalog";
import {
	DEFAULT_READLIST_LABEL,
	DEFAULT_READLIST_SLUG,
	type ReadlistRef,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { withInternalTracking } from "@packages/web-shell";
import type { GmailConnectDisclaimerAction } from "../integrations/gmail-connect-disclaimer.component";
import { GMAIL_CONNECT_PATH } from "../integrations/gmail-connect.url";
import { buildLockableGmailConnectionPrompt, type GmailConnectionPrompt } from "../integrations/gmail-connection-prompt";
import type { FormField } from "../integrations/gmail-form-fields";
import {
	GMAIL_WAITING_CONFIRMATION_MESSAGE,
	gmailFilterErrorMessage,
	gmailMappingDestination,
} from "../integrations/gmail-mappings.viewmodel";
import { discoveryMatchesConnection } from "../integrations/gmail-save-senders";
import {
	chooseState,
	GMAIL_CHECKLIST_MESSAGES,
	type GmailChecklistCommand,
	type GmailChecklistRow,
	RETRY_ACTION,
	SELECT_TOGGLE,
	tickedEmails,
} from "../integrations/gmail-sender-checklist.viewmodel";
import {
	byRecognitionThenName,
	type GmailSenderCandidate,
	gmailSenderCandidates,
	gmailSenderName,
	toGmailSenderResults,
} from "../integrations/gmail-sender-picker.viewmodel";
import { toGmailSenderStatus } from "../integrations/gmail-sender-status.viewmodel";
import type { GmailChecklistView, GmailSenderWidgetViewModel } from "../integrations/gmail-sender-widget.component";
import { GMAIL_PATH } from "../integrations/gmail.url";
import { GMAIL_CONFIRM_FAILED_MESSAGES } from "../integrations/gmail.viewmodel";
import { GMAIL_CONNECT_DISCLAIMER_ID } from "../integrations/integrations-index.viewmodel";
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import {
	buildReadlistGmailUrl,
	READLIST_GMAIL_SELECTION_PARAM,
	type ReadlistGmailSelection,
	readlistGmailDiscoveryPath,
	readlistGmailSavePath,
	readlistGmailSendersPath,
} from "./readlist-gmail-senders.url";
import { readlistPreferencesPath } from "./readlist.url";

const SOURCE = "queue-preferences";

const PARSE_ORIGIN = "https://readplace.com";

export type ReadlistGmailSectionState =
	| "upgrade"
	| "connect"
	| "disconnecting"
	| "reconnect"
	| "awaiting"
	| "filter-failed"
	| "picker";

export interface ReadlistGmailSectionStateInput {
	connection: GmailConnection | undefined;
	canConnectGmail: boolean;
	metadataScopeGranted: boolean;
	discovery: GmailDiscovery | undefined;
}

export interface ReadlistGmailSendersInput extends ReadlistGmailSectionStateInput {
	userId: UserId;
	offer: UpgradeOffer | undefined;
	readlist: { slug: ReadlistSlug; label: string; purpose?: string };
	readlists: readonly ReadlistRef[];
	discoveredSenders: readonly DiscoveredGmailSender[];
	mappings: readonly GmailMapping[];
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	detection: NewsletterDetection;
	selection: ReadlistGmailSelection;
	command: GmailChecklistCommand;
	listed: number | undefined;
	pollCount: number;
}

export interface ReadlistGmailChecklist extends GmailChecklistView {
	sender: ForwardableSender[];
	added: ForwardableSender[];
}

export interface ReadlistGmailPickerViewModel extends GmailSenderWidgetViewModel {
	autoDiscoverHtml: string;
	selectionFields: FormField[];
	saveAction: string;
	checklist: ReadlistGmailChecklist;
}

export interface ReadlistGmailLink {
	key: string;
	label: string;
	href: string;
}

export interface ReadlistGmailConnect {
	label: string;
	disclaimer: GmailConnectDisclaimerAction;
}

export interface ReadlistGmailSendersViewModel {
	sectionClass: string;
	state: ReadlistGmailSectionState;
	lede: string;
	notes: string[];
	prompt: GmailConnectionPrompt | undefined;
	connect: ReadlistGmailConnect | undefined;
	links: ReadlistGmailLink[];
	picker: ReadlistGmailPickerViewModel | undefined;
	pageUrl: string;
	commandApplied: boolean;
}

function track({ href, content }: { href: string; content: string }): string {
	return withInternalTracking(href, { source: SOURCE, content });
}

function trackingFields(content: string): FormField[] {
	return Array.from(new URL(track({ href: "/", content }), PARSE_ORIGIN).searchParams, ([name, value]) => ({ name, value }));
}

const MARKER_FIELD: FormField = { name: READLIST_GMAIL_SELECTION_PARAM, value: "1" };

function sameMailboxDiscovery(input: { discovery: GmailDiscovery | undefined; connection: GmailConnection }): GmailDiscovery | undefined {
	return discoveryMatchesConnection(input.discovery, input.connection) ? input.discovery : undefined;
}

function connected(state: ReadlistGmailSectionState): (input: ReadlistGmailSectionStateInput) => ReadlistGmailSectionState {
	return (input) => {
		const { connection } = input;
		assert(connection, "a connected Gmail state requires a connection");
		const senderAccessLost =
			connection.accountEmail === undefined
			|| !input.metadataScopeGranted
			|| sameMailboxDiscovery({ discovery: input.discovery, connection })?.requiresReconnect === true;
		return senderAccessLost ? "reconnect" : state;
	};
}

const SECTION_STATE: Record<GmailConnectionState, (input: ReadlistGmailSectionStateInput) => ReadlistGmailSectionState> = {
	disconnected: (input) => (input.canConnectGmail ? "connect" : "upgrade"),
	disconnecting: () => "disconnecting",
	revoked: () => "reconnect",
	"filter-failed": connected("filter-failed"),
	"confirm-failed": connected("awaiting"),
	"awaiting-confirmation": connected("awaiting"),
	"ready-to-filter": connected("picker"),
	filtering: connected("picker"),
};

export function readlistGmailSectionState(input: ReadlistGmailSectionStateInput): ReadlistGmailSectionState {
	return SECTION_STATE[gmailConnectionState(input.connection)](input);
}

const PICKER_VISIBLE: Record<ReadlistGmailSectionState, boolean> = {
	upgrade: false,
	connect: false,
	disconnecting: false,
	reconnect: false,
	awaiting: true,
	"filter-failed": true,
	picker: true,
};

export function readlistGmailPickerVisible(state: ReadlistGmailSectionState): boolean {
	return PICKER_VISIBLE[state];
}

const SECTION_CLASS: Record<ReadlistGmailSectionState, string> = {
	upgrade: "readlist-gmail--upgrade",
	connect: "readlist-gmail--connect",
	disconnecting: "readlist-gmail--disconnecting",
	reconnect: "readlist-gmail--reconnect",
	awaiting: "readlist-gmail--awaiting",
	"filter-failed": "readlist-gmail--filter-failed",
	picker: "readlist-gmail--picker",
};

function routingOf(input: {
	sender: GmailMapping;
	userId: UserId;
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	readlists: readonly ReadlistRef[];
}): GmailSenderRouting {
	const deliveryMode = pickerDeliveryMode(input.sender);
	if (input.sender.addedToFilterAt === undefined) {
		return { kind: input.sender.mappedAddresses === undefined ? "unmapped" : "unrouted", deliveryMode };
	}
	const destination = gmailMappingDestination(input);
	if (destination.kind === "unresolved") return { kind: "unresolved" };
	return {
		kind: "routed",
		readlists: destination.readlists.map((readlist) => readlist.slug).filter((slug) => slug !== DEFAULT_READLIST_SLUG),
		deliveryMode,
	};
}

export function gmailSenderRoutingFor(input: {
	mappings: readonly GmailMapping[];
	userId: UserId;
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	readlists: readonly ReadlistRef[];
}): Map<ForwardableSender, GmailSenderRouting> {
	return new Map(input.mappings.map((sender): [ForwardableSender, GmailSenderRouting] => [sender.senderEmail, routingOf({ ...input, sender })]));
}

function routesHere(routing: GmailSenderRouting | undefined, slug: ReadlistSlug): boolean {
	return routing?.kind === "routed" && routing.readlists.includes(slug);
}

const LABEL_LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

function routedNote(input: { routing: GmailSenderRouting | undefined; readlists: readonly ReadlistRef[] }): string {
	assert(input.routing, "an elsewhere row has a routing");
	assert(input.routing.kind === "routed", "an elsewhere row is a routed sender");
	const labels = input.routing.readlists.map((slug) => {
		const readlist = input.readlists.find((candidate) => candidate.slug === slug);
		assert(readlist, "a routed sender's readlist resolves to a reader readlist");
		return readlist.label;
	});
	return `In ${LABEL_LIST.format([DEFAULT_READLIST_LABEL, ...labels])}`;
}

function checklistIntro(label: string): string {
	return `Tick the newsletters to save to ${label}. A newsletter in other readlists stays there too. Looking for a sender that isn't listed? Search all your senders below.`;
}

function toReadlistGmailChecklist(input: {
	readlist: { slug: ReadlistSlug; label: string };
	readlists: readonly ReadlistRef[];
	candidates: ReadonlyMap<ForwardableSender, GmailSenderCandidate>;
	routing: ReadonlyMap<ForwardableSender, GmailSenderRouting>;
	catalogAvailable: boolean;
	selection: ReadlistGmailSelection;
	command: GmailChecklistCommand;
}): ReadlistGmailChecklist {
	const slug = input.readlist.slug;
	const candidates = [...input.candidates.values()].sort(byRecognitionThenName);
	const routingFor = (candidate: GmailSenderCandidate) => input.routing.get(candidate.email);
	const here = candidates.filter((candidate) => routesHere(routingFor(candidate), slug));
	const elsewhere = candidates.filter((candidate) => routingFor(candidate)?.kind === "routed" && !here.includes(candidate));
	const known = candidates.filter((candidate) => !candidate.mapped && candidate.recognized);
	const picked = input.command.pick === undefined ? [] : [input.command.pick];
	const base = input.selection.edited ? input.selection.sender : here.map((candidate) => candidate.email);
	const tickRequests = [...base, ...picked];
	const requested = new Set([...tickRequests, ...input.selection.added]);
	const added = candidates.filter(
		(candidate) => !candidate.mapped && !candidate.recognized && requested.has(candidate.email) && candidate.email !== input.command.dismiss,
	);
	const listed = [...here, ...elsewhere, ...known, ...added];
	const ticked = tickedEmails({ requested: tickRequests, select: input.command.select, listed });
	const row = (extras: (candidate: GmailSenderCandidate) => Pick<GmailChecklistRow, "fields" | "notes">) => (candidate: GmailSenderCandidate): GmailChecklistRow => ({
		email: candidate.email,
		name: gmailSenderName(candidate),
		checked: ticked.has(candidate.email),
		autofocus: false,
		...extras(candidate),
	});
	const groups = [
		{ key: "here", title: `In ${input.readlist.label}`, rows: here.map(row((candidate) => ({ fields: [{ name: "routed", value: candidate.email }], notes: [] }))), actions: [] },
		{ key: "elsewhere", title: "In other readlists", rows: elsewhere.map(row((candidate) => ({ fields: [], notes: [routedNote({ routing: routingFor(candidate), readlists: input.readlists })] }))), actions: [] },
		{ key: "known", title: "Known newsletters", rows: known.map(row(() => ({ fields: [], notes: [] }))), actions: [] },
		{ key: "added", title: "Senders you added", rows: added.map(row((candidate) => ({ fields: [{ name: "added", value: candidate.email }], notes: [] }))), actions: [{ name: "dismiss", label: "Remove" }] },
	];
	const state = chooseState({ candidates, catalogAvailable: input.catalogAvailable, known });
	const allTicked = listed.every((candidate) => ticked.has(candidate.email));
	const toggle = listed.length === 0 ? [] : [SELECT_TOGGLE[allTicked ? "none" : "all"]];
	return {
		state,
		intro: checklistIntro(input.readlist.label),
		message: GMAIL_CHECKLIST_MESSAGES[state],
		groups: groups.filter((group) => group.rows.length > 0),
		total: listed.length,
		knownCount: known.length,
		actions: state === "catalog-unavailable" ? [RETRY_ACTION, ...toggle] : toggle,
		sender: listed.filter((candidate) => ticked.has(candidate.email)).map((candidate) => candidate.email),
		added: added.map((candidate) => candidate.email),
	};
}

const IDLE_DISCOVERY = { state: "idle", mode: "profile", checkedMessageCount: 0 } as const;

function toPicker(input: ReadlistGmailSendersInput): ReadlistGmailPickerViewModel {
	const { connection } = input;
	assert(connection, "the Gmail sender picker requires a connection");
	const slug = input.readlist.slug;
	const routing = gmailSenderRoutingFor(input);
	const candidates = gmailSenderCandidates({ discoveredSenders: input.discoveredSenders, senders: input.mappings, detection: input.detection });
	const checklist = toReadlistGmailChecklist({
		readlist: input.readlist,
		readlists: input.readlists,
		candidates,
		routing,
		catalogAvailable: input.detection.status === "available",
		selection: input.selection,
		command: input.command,
	});
	const searchable = new Map(
		[...candidates]
			.filter(([email]) => routing.get(email)?.kind !== "unresolved")
			.map(([email, candidate]): [ForwardableSender, GmailSenderCandidate] => [email, { ...candidate, mapped: routesHere(routing.get(email), slug) }]),
	);
	const results = toGmailSenderResults({ state: { search: input.selection.search }, candidates: searchable });
	const pollUrl = (nextPoll: number) => {
		const poll = new URL(
			buildReadlistGmailUrl({ slug, selection: { edited: true, sender: [], added: [], search: "", discoveryStarted: true, discoveryAfter: input.selection.discoveryAfter } }),
			PARSE_ORIGIN,
		);
		poll.pathname = readlistGmailSendersPath(slug);
		poll.searchParams.set("poll", String(nextPoll));
		return `${poll.pathname}${poll.search}`;
	};
	return {
		autoDiscoverHtml: "",
		selectionFields: [MARKER_FIELD, ...trackingFields("select-gmail-senders")],
		saveAction: track({ href: readlistGmailSavePath(slug), content: "save-gmail-newsletters" }),
		discoveryAction: track({ href: readlistGmailDiscoveryPath(slug), content: "load-gmail-senders" }),
		discoveryFields: [
			MARKER_FIELD,
			...checklist.sender.map((value) => ({ name: "sender", value })),
			...checklist.added.map((value) => ({ name: "added", value })),
			...trackingFields("load-gmail-senders"),
		],
		pagePath: readlistPreferencesPath(slug),
		searchPath: readlistGmailSendersPath(slug),
		searchFields: [MARKER_FIELD, ...trackingFields("search-gmail-senders")],
		senderPicker: { open: input.selection.search !== "", searchAutofocus: false },
		search: input.selection.search,
		status: toGmailSenderStatus({
			offer: input.offer,
			canConnectGmail: input.canConnectGmail,
			discovery: sameMailboxDiscovery({ discovery: input.discovery, connection }) ?? IDLE_DISCOVERY,
			discoveredCount: input.discoveredSenders.length,
			discoveryStarted: input.selection.discoveryStarted,
			discoveryPending: input.selection.discoveryAfter === (input.discovery?.updatedAt ?? "none"),
			discoveryAfter: input.selection.discoveryAfter,
			pollCount: input.pollCount,
			listed: input.listed,
			knownCount: checklist.knownCount,
			pollUrl,
			track,
		}),
		checklist,
		results: {
			resultsState: results.resultsState,
			resultsMessage: results.resultsMessage,
			refineSearch: results.resultsState === "limited",
			options: results.options,
		},
	};
}

const LEDES: Record<"unset" | "set", (label: string) => string> = {
	unset: (label) => `New issues from the Gmail newsletters you tick here are saved to ${DEFAULT_READLIST_LABEL} and ${label}.`,
	set: (label) => `New issues from the Gmail newsletters you tick here are saved to ${DEFAULT_READLIST_LABEL}. The ones that fit are also saved to ${label}.`,
};

const GMAIL_DISCONNECTING_MESSAGE = "Gmail is disconnecting. Connect it again once it finishes.";

function gmailLink(input: { key: string; label: string }): ReadlistGmailLink {
	return { ...input, href: track({ href: GMAIL_PATH, content: input.key }) };
}

interface SectionView {
	notes: string[];
	prompt: GmailConnectionPrompt | undefined;
	connect: ReadlistGmailConnect | undefined;
	links: ReadlistGmailLink[];
}

const NO_VIEW: SectionView = { notes: [], prompt: undefined, connect: undefined, links: [] };

function connectedOf(input: ReadlistGmailSendersInput): GmailConnection {
	assert(input.connection, "a connected Gmail state requires a connection");
	return input.connection;
}

function promptLock(input: ReadlistGmailSendersInput): { offer: UpgradeOffer | undefined; controlClass: string } {
	return { offer: input.offer, controlClass: "btn btn--primary btn--m" };
}

const SECTION_VIEW: Record<ReadlistGmailSectionState, (input: ReadlistGmailSendersInput) => SectionView> = {
	upgrade: (input) => ({
		...NO_VIEW,
		prompt: buildLockableGmailConnectionPrompt({ canConnectGmail: false, message: "", content: "connect-gmail", label: "Connect Gmail", variant: "primary", fields: [], track, lock: promptLock(input) }),
	}),
	connect: () => ({
		...NO_VIEW,
		connect: {
			label: "Connect Gmail",
			disclaimer: { confirmPopoverId: GMAIL_CONNECT_DISCLAIMER_ID, href: track({ href: GMAIL_CONNECT_PATH, content: "connect-gmail" }) },
		},
	}),
	disconnecting: () => ({ ...NO_VIEW, notes: [GMAIL_DISCONNECTING_MESSAGE] }),
	reconnect: (input) => ({
		...NO_VIEW,
		prompt: connectedOf(input).revokedAt === undefined
			? buildLockableGmailConnectionPrompt({
				canConnectGmail: input.canConnectGmail,
				message: "Reconnect Gmail to choose senders from your mailbox. The newsletters you set up stay in place.",
				content: "grant-sender-access", label: "Reconnect Gmail", variant: "primary", fields: [], track, lock: promptLock(input),
			})
			: buildLockableGmailConnectionPrompt({
				canConnectGmail: input.canConnectGmail,
				message: "Google ended the connection. Reconnect to keep forwarding newsletters.",
				content: "reconnect", label: "Reconnect Gmail", variant: "primary", fields: [], track, lock: promptLock(input),
			}),
	}),
	awaiting: (input) => {
		const confirmError = connectedOf(input).lastConfirmError;
		return {
			...NO_VIEW,
			notes: [confirmError === undefined ? GMAIL_WAITING_CONFIRMATION_MESSAGE : GMAIL_CONFIRM_FAILED_MESSAGES[confirmError.reason]],
			links: [gmailLink({ key: "finish-gmail-setup", label: "Finish setup" })],
		};
	},
	"filter-failed": (input) => {
		const connection = connectedOf(input);
		const error = connection.lastFilterError;
		assert(error, "the filter-failed state requires a stored filter error");
		return {
			...NO_VIEW,
			notes: [gmailFilterErrorMessage({ error, connection, destinations: input.destinations, readlists: input.readlists })],
			links: [gmailLink({ key: "open-gmail-newsletters", label: "Open Gmail newsletters" })],
		};
	},
	picker: () => ({ ...NO_VIEW, links: [gmailLink({ key: "manage-gmail-newsletters", label: "Manage Gmail newsletters" })] }),
};

export function toReadlistGmailSenders(input: ReadlistGmailSendersInput): ReadlistGmailSendersViewModel {
	const state = readlistGmailSectionState(input);
	const picker = readlistGmailPickerVisible(state) ? toPicker(input) : undefined;
	const selection: ReadlistGmailSelection = picker === undefined
		? input.selection
		: { ...input.selection, edited: true, sender: picker.checklist.sender, added: picker.checklist.added };
	return {
		sectionClass: SECTION_CLASS[state],
		state,
		lede: LEDES[input.readlist.purpose === undefined ? "unset" : "set"](input.readlist.label),
		...SECTION_VIEW[state](input),
		picker,
		pageUrl: buildReadlistGmailUrl({ slug: input.readlist.slug, selection }),
		commandApplied: [input.command.pick, input.command.select, input.command.dismiss].some((value) => value !== undefined),
	};
}
