import type { DiscoveredGmailSender, ForwardableSender, GmailMapping } from "@packages/domain/gmail";
import type { NewsletterDetection, NewsletterRecognition } from "@packages/domain/newsletter-catalog";
import { GMAIL_SENDER_OPTION_LIMIT, type GmailPickerState } from "./gmail.url";

export type GmailSenderResultsState =
	| "no-discovered-senders"
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
}

export interface GmailSenderResults {
	resultsState: GmailSenderResultsState;
	resultsMessage: string;
	options: GmailSenderOption[];
}

export function gmailSenderCandidates(input: {
	discoveredSenders: readonly DiscoveredGmailSender[];
	senders: readonly GmailMapping[];
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

export function byRecognitionThenName(left: GmailSenderCandidate, right: GmailSenderCandidate): number {
	if (left.recognized !== right.recognized) return left.recognized ? -1 : 1;
	const byName = (left.newsletterName ?? left.email).localeCompare(right.newsletterName ?? right.email);
	return byName === 0 ? left.email.localeCompare(right.email) : byName;
}

function searchableText(candidate: GmailSenderCandidate): string {
	return [candidate.email, candidate.newsletterName ?? "", candidate.displayName ?? ""].join(" ").toLowerCase();
}

export function gmailSenderName(candidate: GmailSenderCandidate): string | undefined {
	return candidate.newsletterName ?? candidate.displayName;
}

function resultsMessage(input: { resultsState: GmailSenderResultsState; search: string; total: number }): string {
	switch (input.resultsState) {
		case "no-discovered-senders":
			return "No senders discovered yet.";
		case "no-matches":
			return `No discovered senders match “${input.search.trim()}”.`;
		case "limited":
			return `Showing ${GMAIL_SENDER_OPTION_LIMIT} of ${input.total} senders. Refine your search to find another sender.`;
		case "listed":
			return "";
	}
}

function chooseResultsState(input: { candidateCount: number; matchCount: number }): GmailSenderResultsState {
	if (input.candidateCount === 0) return "no-discovered-senders";
	if (input.matchCount === 0) return "no-matches";
	return input.matchCount > GMAIL_SENDER_OPTION_LIMIT ? "limited" : "listed";
}

export function toGmailSenderResults(input: {
	state: GmailPickerState;
	candidates: ReadonlyMap<ForwardableSender, GmailSenderCandidate>;
}): GmailSenderResults {
	const search = input.state.search ?? "";
	const needle = search.trim().toLowerCase();
	const all = [...input.candidates.values()];
	const matches = all
		.filter((candidate) => !candidate.mapped && searchableText(candidate).includes(needle))
		.sort(byRecognitionThenName);
	const resultsState = chooseResultsState({ candidateCount: all.length, matchCount: matches.length });
	return {
		resultsState,
		resultsMessage: resultsMessage({ resultsState, search, total: matches.length }),
		options: matches.slice(0, GMAIL_SENDER_OPTION_LIMIT).map((candidate) => ({
			email: candidate.email,
			name: gmailSenderName(candidate),
		})),
	};
}
