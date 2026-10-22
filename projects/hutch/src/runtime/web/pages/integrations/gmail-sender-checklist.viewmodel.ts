import type { ForwardableSender } from "@packages/domain/gmail";
import type { FormField } from "./gmail-form-fields";
import { byRecognitionThenName, type GmailSenderCandidate, gmailSenderName } from "./gmail-sender-picker.viewmodel";
import type { GmailPickerState } from "./gmail.url";

export type GmailChecklistState = "listed" | "catalog-unavailable" | "no-discovered-senders" | "no-known-newsletters" | "all-known-mapped";

export type GmailChecklistSelect = "all" | "none";

export interface GmailChecklistCommand {
	pick: ForwardableSender | undefined;
	select: GmailChecklistSelect | undefined;
}

export interface GmailChecklistRow {
	email: ForwardableSender;
	name: string | undefined;
	checked: boolean;
	autofocus: boolean;
	fields: FormField[];
}

export interface GmailChecklistGroup {
	key: "editing" | "known" | "added";
	title: string;
	rows: GmailChecklistRow[];
}

export interface GmailChecklistAction {
	key: "select" | "retry";
	name: string | undefined;
	value: string;
	label: string;
}

export interface GmailSenderChecklist {
	state: GmailChecklistState;
	intro: string;
	message: string;
	groups: GmailChecklistGroup[];
	total: number;
	knownCount: number;
	actions: GmailChecklistAction[];
	sender: ForwardableSender[];
	added: ForwardableSender[];
}

const GMAIL_CHECKLIST_INTRO =
	"These are the known newsletters in your Gmail. Tick the ones to send to your readlists. Looking for a sender that isn't listed? Search all your senders below and it joins this list.";

const GMAIL_CHECKLIST_MESSAGES: Record<GmailChecklistState, string> = {
	listed: "",
	"catalog-unavailable": "Newsletter suggestions are unavailable right now. Try again, or search all your senders below.",
	"no-discovered-senders": "No senders discovered yet.",
	"no-known-newsletters": "None of your senders is a known newsletter yet. Search all your senders below to add one.",
	"all-known-mapped": "Every known newsletter in your Gmail is already in your newsletters. Search all your senders below to add another.",
};

const GMAIL_CHECKLIST_TITLES: Record<GmailChecklistGroup["key"], string> = {
	editing: "Editing",
	known: "Known newsletters",
	added: "Senders you added",
};

const SELECT_TOGGLE: Record<GmailChecklistSelect, GmailChecklistAction> = {
	all: { key: "select", name: "select", value: "all", label: "Select all" },
	none: { key: "select", name: "select", value: "none", label: "Clear selection" },
};

const RETRY_ACTION: GmailChecklistAction = { key: "retry", name: undefined, value: "", label: "Try again" };

function chooseState(input: { candidates: readonly GmailSenderCandidate[]; catalogAvailable: boolean; known: readonly GmailSenderCandidate[] }): GmailChecklistState {
	if (input.candidates.length === 0) return "no-discovered-senders";
	if (!input.catalogAvailable) return "catalog-unavailable";
	if (input.known.length > 0) return "listed";
	return input.candidates.some((candidate) => candidate.recognized) ? "all-known-mapped" : "no-known-newsletters";
}

function tickedEmails(input: { requested: readonly string[]; select: GmailChecklistSelect | undefined; listed: readonly GmailSenderCandidate[] }): Set<string> {
	if (input.select === "all") return new Set(input.listed.map((candidate) => candidate.email));
	if (input.select === "none") return new Set();
	return new Set(input.requested);
}

export function toGmailSenderChecklist(input: {
	state: GmailPickerState;
	candidates: ReadonlyMap<ForwardableSender, GmailSenderCandidate>;
	catalogAvailable: boolean;
	command: GmailChecklistCommand;
}): GmailSenderChecklist {
	const candidates = [...input.candidates.values()].sort(byRecognitionThenName);
	const picked = input.command.pick === undefined ? [] : [input.command.pick];
	const tickRequests = [...(input.state.sender ?? []), ...picked];
	const requested = new Set([...tickRequests, ...(input.state.added ?? [])]);
	const known = candidates.filter((candidate) => !candidate.mapped && candidate.recognized);
	const editing = candidates.filter((candidate) => candidate.mapped && requested.has(candidate.email));
	const added = candidates.filter((candidate) => !candidate.mapped && requested.has(candidate.email) && !known.includes(candidate));
	const listed = [...editing, ...known, ...added];
	const ticked = tickedEmails({ requested: tickRequests, select: input.command.select, listed });
	const row = (fields: (candidate: GmailSenderCandidate) => FormField[]) => (candidate: GmailSenderCandidate): GmailChecklistRow => ({
		email: candidate.email,
		name: gmailSenderName(candidate),
		checked: ticked.has(candidate.email),
		autofocus: false,
		fields: fields(candidate),
	});
	const groups: GmailChecklistGroup[] = [
		{ key: "editing", title: GMAIL_CHECKLIST_TITLES.editing, rows: editing.map(row(() => [])) },
		{ key: "known", title: GMAIL_CHECKLIST_TITLES.known, rows: known.map(row(() => [])) },
		{ key: "added", title: GMAIL_CHECKLIST_TITLES.added, rows: added.map(row((candidate) => [{ name: "added", value: candidate.email }])) },
	];
	const state = chooseState({ candidates, catalogAvailable: input.catalogAvailable, known });
	const allTicked = listed.every((candidate) => ticked.has(candidate.email));
	const toggle = listed.length === 0 ? [] : [SELECT_TOGGLE[allTicked ? "none" : "all"]];
	return {
		state,
		intro: GMAIL_CHECKLIST_INTRO,
		message: GMAIL_CHECKLIST_MESSAGES[state],
		groups: groups.filter((group) => group.rows.length > 0),
		total: listed.length,
		knownCount: known.length,
		actions: state === "catalog-unavailable" ? [RETRY_ACTION, ...toggle] : toggle,
		sender: listed.filter((candidate) => ticked.has(candidate.email)).map((candidate) => candidate.email),
		added: added.map((candidate) => candidate.email),
	};
}
