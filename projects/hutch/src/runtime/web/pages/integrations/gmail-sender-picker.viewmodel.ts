import type { DiscoveredGmailSender, ForwardableSender, GmailSenderEntry } from "@packages/domain/gmail";
import type { NewsletterDetection, NewsletterRecognition } from "@packages/domain/newsletter-catalog";
import { type FormField, gmailGetFields } from "./gmail-form-fields";
import { GMAIL_SENDER_OPTION_LIMIT, type GmailPickerState } from "./gmail.url";

export type GmailSenderResultsState =
	| "catalog-unavailable"
	| "no-discovered-senders"
	| "no-recognized-newsletters"
	| "no-matches"
	| "listed"
	| "limited";

export interface GmailSenderCandidate {
	email: ForwardableSender;
	displayName: string | undefined;
	newsletterName: string | undefined;
	recognized: boolean;
	mapped: boolean;
}

export interface GmailSenderOption {
	email: string;
	name: string | undefined;
	fields: FormField[];
}

export interface GmailResultsAction {
	key: "suggestions-retry" | "browse-all" | "known-only";
	label: string;
	fields: FormField[];
}

export interface GmailSenderResults {
	resultsState: GmailSenderResultsState;
	resultsMessage: string;
	options: GmailSenderOption[];
	actions: GmailResultsAction[];
}

export function gmailSenderCandidates(input: {
	discoveredSenders: readonly DiscoveredGmailSender[];
	senders: readonly GmailSenderEntry[];
	detection: NewsletterDetection;
}): Map<ForwardableSender, GmailSenderCandidate> {
	const recognized: ReadonlyMap<ForwardableSender, NewsletterRecognition> =
		input.detection.status === "available" ? input.detection.recognized : new Map();
	const mapped = new Set(input.senders.filter((sender) => sender.addedToFilterAt !== undefined).map((sender) => sender.senderEmail));
	const candidates = new Map<ForwardableSender, GmailSenderCandidate>();
	const add = (email: ForwardableSender, displayName: string | undefined) => {
		const recognition = recognized.get(email);
		candidates.set(email, {
			email,
			displayName,
			newsletterName: recognition?.name,
			recognized: recognition !== undefined,
			mapped: mapped.has(email),
		});
	};
	for (const sender of input.discoveredSenders) add(sender.email, sender.name);
	for (const email of mapped) {
		if (!candidates.has(email)) add(email, undefined);
	}
	return candidates;
}

function byRecognitionThenName(left: GmailSenderCandidate, right: GmailSenderCandidate): number {
	if (left.recognized !== right.recognized) return left.recognized ? -1 : 1;
	const byName = (left.newsletterName ?? left.email).localeCompare(right.newsletterName ?? right.email);
	return byName === 0 ? left.email.localeCompare(right.email) : byName;
}

function searchableText(candidate: GmailSenderCandidate): string {
	return [candidate.email, candidate.newsletterName ?? "", candidate.displayName ?? ""].join(" ").toLowerCase();
}

function resultsMessage(input: { resultsState: GmailSenderResultsState; search: string; total: number }): string {
	switch (input.resultsState) {
		case "catalog-unavailable":
			return "Newsletter suggestions are unavailable. Try again, or search your discovered senders.";
		case "no-discovered-senders":
			return "No senders discovered yet.";
		case "no-recognized-newsletters":
			return "None of your discovered senders is a known newsletter yet. Search for a sender, or browse all senders.";
		case "no-matches":
			return `No discovered senders match “${input.search.trim()}”.`;
		case "limited":
			return `Showing ${GMAIL_SENDER_OPTION_LIMIT} of ${input.total} senders. Refine your search to find another sender.`;
		case "listed":
			return "";
	}
}

function chooseResultsState(input: {
	candidateCount: number;
	browsingKnown: boolean;
	catalogAvailable: boolean;
	matchCount: number;
}): GmailSenderResultsState {
	if (input.candidateCount === 0) return "no-discovered-senders";
	if (input.browsingKnown && !input.catalogAvailable) return "catalog-unavailable";
	if (input.matchCount === 0) return input.browsingKnown ? "no-recognized-newsletters" : "no-matches";
	return input.matchCount > GMAIL_SENDER_OPTION_LIMIT ? "limited" : "listed";
}

function resultsActions(input: {
	state: GmailPickerState;
	resultsState: GmailSenderResultsState;
	browsingKnown: boolean;
}): GmailResultsAction[] {
	const actions: GmailResultsAction[] = [];
	if (input.resultsState === "catalog-unavailable") {
		actions.push({ key: "suggestions-retry", label: "Try again", fields: gmailGetFields(input.state, "retry-suggestions") });
	}
	if (input.resultsState === "no-discovered-senders") return actions;
	if (input.browsingKnown) {
		actions.push({
			key: "browse-all",
			label: "Browse all senders",
			fields: gmailGetFields({ ...input.state, advanced: "1" }, "browse-all-senders"),
		});
	} else if (input.state.advanced === "1") {
		const { advanced: _advanced, ...known } = input.state;
		actions.push({ key: "known-only", label: "Show known newsletters only", fields: gmailGetFields(known, "known-newsletters") });
	}
	return actions;
}

export function toGmailSenderResults(input: {
	state: GmailPickerState;
	candidates: ReadonlyMap<ForwardableSender, GmailSenderCandidate>;
	catalogAvailable: boolean;
}): GmailSenderResults {
	const search = input.state.search ?? "";
	const needle = search.trim().toLowerCase();
	const browsingKnown = needle === "" && input.state.advanced !== "1";
	const all = [...input.candidates.values()];
	const unmapped = all.filter((candidate) => !candidate.mapped);
	const matches = (browsingKnown
		? unmapped.filter((candidate) => candidate.recognized)
		: unmapped.filter((candidate) => searchableText(candidate).includes(needle))
	).sort(byRecognitionThenName);
	const { edit: _edit, ...chooserState } = input.state;
	const resultsState = chooseResultsState({
		candidateCount: all.length,
		browsingKnown,
		catalogAvailable: input.catalogAvailable,
		matchCount: matches.length,
	});
	return {
		resultsState,
		resultsMessage: resultsMessage({ resultsState, search, total: matches.length }),
		options: matches.slice(0, GMAIL_SENDER_OPTION_LIMIT).map((candidate) => ({
			email: candidate.email,
			name: candidate.newsletterName,
			fields: gmailGetFields({ ...chooserState, sender: candidate.email }, "choose-newsletter"),
		})),
		actions: resultsActions({ state: input.state, resultsState, browsingKnown }),
	};
}
