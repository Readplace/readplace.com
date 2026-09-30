import { withInternalTracking } from "@packages/web-shell";
import { buildGmailUrl, type GmailPickerState } from "./gmail.url";

export interface FormField {
	name: string;
	value: string;
}

export interface GmailFormAction {
	key: string;
	method: "GET" | "POST";
	action: string;
	label: string;
	variant: "primary" | "secondary" | "neutral" | "destructive";
	fields: FormField[];
}

const GMAIL_SOURCE = "integrations-gmail";

export function trackGmail(href: string, content: string): string {
	return withInternalTracking(href, { source: GMAIL_SOURCE, content });
}

function queryFields(href: string): FormField[] {
	const url = new URL(href, "https://readplace.com");
	return Array.from(url.searchParams, ([name, value]) => ({ name, value }));
}

export function gmailGetFields(state: GmailPickerState, content: string): FormField[] {
	return queryFields(trackGmail(buildGmailUrl({ ...state, discovery: "started" }), content));
}

export function gmailBodyFields(state: GmailPickerState): FormField[] {
	return queryFields(buildGmailUrl(state));
}
