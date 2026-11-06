import type { ReadlistSlug } from "@packages/domain/readlist";
import { parseGmailPickerState } from "../integrations/gmail.url";
import { readlistPreferencesPath } from "./readlist.url";

export const READLIST_GMAIL_SELECTION_PARAM = "gmail_selection";

export const READLIST_GMAIL_SECTION_ID = "readlist-gmail-senders";

export interface ReadlistGmailSelection {
	edited: boolean;
	sender: readonly string[];
	search: string;
	discoveryStarted: boolean;
	discoveryAfter: string | undefined;
}

export function readlistGmailSendersPath(readlist: ReadlistSlug): string {
	return `${readlistPreferencesPath(readlist)}/gmail/senders`;
}

export function readlistGmailDiscoveryPath(readlist: ReadlistSlug): string {
	return `${readlistPreferencesPath(readlist)}/gmail/discovery`;
}

export function readlistGmailSavePath(readlist: ReadlistSlug): string {
	return `${readlistPreferencesPath(readlist)}/gmail`;
}

export function parseReadlistGmailSelection(query: Record<string, unknown>): ReadlistGmailSelection {
	const picker = parseGmailPickerState(query);
	return {
		edited: query[READLIST_GMAIL_SELECTION_PARAM] === "1",
		sender: picker.sender ?? [],
		search: picker.search ?? "",
		discoveryStarted: query.discovery === "started",
		discoveryAfter: picker.discovery_after,
	};
}

export function buildReadlistGmailUrl(input: { slug: ReadlistSlug; selection: ReadlistGmailSelection }): string {
	const { selection } = input;
	const query = new URLSearchParams({ [READLIST_GMAIL_SELECTION_PARAM]: "1" });
	for (const sender of new Set(selection.sender)) query.append("sender", sender);
	if (selection.search !== "") query.set("search", selection.search);
	if (selection.discoveryStarted) query.set("discovery", "started");
	if (selection.discoveryAfter !== undefined) query.set("discovery_after", selection.discoveryAfter);
	return `${readlistPreferencesPath(input.slug)}?${query.toString()}#${READLIST_GMAIL_SECTION_ID}`;
}
