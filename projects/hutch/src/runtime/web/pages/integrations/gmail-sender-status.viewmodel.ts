import type { GmailDiscovery } from "@packages/domain/gmail";
import { GMAIL_UPGRADE_MESSAGE } from "./gmail-connection-access";
import { buildGmailConnectionPrompt } from "./gmail-connection-prompt";
import type { GmailFormAction } from "./gmail-form-fields";
import { GMAIL_DISCOVERY_FAST_POLLS, GMAIL_DISCOVERY_MAX_POLLS } from "./gmail.url";

export interface GmailSenderStatusViewModel {
	discoveryState: string;
	discoveryAfter: string | undefined;
	statusLead: string;
	checkedLabel: string | undefined;
	loadButtonLabel: string;
	reconnectActions: GmailFormAction[];
	refreshActions: { label: string }[];
	pollUrl: string | undefined;
	pollTrigger: string | undefined;
}

export interface GmailSenderDiscoveryProgress {
	state: "idle" | GmailDiscovery["state"];
	mode: GmailDiscovery["mode"];
	checkedMessageCount: number;
	requiresReconnect?: boolean;
}

export interface GmailSenderStatusInput {
	canConnectGmail: boolean;
	discovery: GmailSenderDiscoveryProgress;
	discoveredCount: number;
	discoveryStarted: boolean;
	discoveryPending: boolean;
	discoveryAfter: string | undefined;
	pollCount: number;
	listed: number | undefined;
	knownCount: number;
	pollUrl: (nextPoll: number) => string;
	track: (link: { href: string; content: string }) => string;
}

function checkedLabel(count: number, suffix: string): string {
	return `Checked ${count.toLocaleString("en")} ${count === 1 ? "message" : "messages"}${suffix}`;
}

function checkingForNewMessages(input: GmailSenderStatusInput): boolean {
	return input.discovery.mode === "history" || (input.discoveryPending && input.discovery.state === "complete");
}

function discoveryStatus(input: GmailSenderStatusInput, discovering: boolean): { lead: string; checked: string | undefined } {
	const count = input.discovery.checkedMessageCount;
	if (input.discovery.requiresReconnect) {
		return { lead: input.canConnectGmail ? "Reconnect Gmail to continue loading senders. The newsletters you set up stay in place." : GMAIL_UPGRADE_MESSAGE, checked: undefined };
	}
	if (discovering && input.pollCount >= GMAIL_DISCOVERY_MAX_POLLS) {
		return { lead: "Still checking. ", checked: checkedLabel(count, " so far…") };
	}
	if (discovering) {
		return { lead: checkingForNewMessages(input) ? "Checking for new messages · " : "Checking… ", checked: checkedLabel(count, "") };
	}
	if (input.discovery.state === "idle") return { lead: "Load senders from your Gmail account to choose one.", checked: undefined };
	if (input.discovery.state === "failed") {
		return {
			lead: "I couldn't finish loading your Gmail senders. Your saved choices are still available. Try Load senders again.",
			checked: undefined,
		};
	}
	const discovered = input.discoveredCount;
	return { lead: `${discovered.toLocaleString("en")} ${discovered === 1 ? "sender" : "senders"} discovered · `, checked: checkedLabel(count, "") };
}

function discoveryPollTrigger(nextPoll: number): "every 3s" | "every 15s" {
	return nextPoll <= GMAIL_DISCOVERY_FAST_POLLS ? "every 3s" : "every 15s";
}

function refreshActions(input: { listed: number | undefined; knownCount: number }): { label: string }[] {
	if (input.listed === undefined || input.knownCount <= input.listed) return [];
	const found = input.knownCount - input.listed;
	return [{ label: `Show ${found.toLocaleString("en")} newly found ${found === 1 ? "newsletter" : "newsletters"}` }];
}

export function toGmailSenderStatus(input: GmailSenderStatusInput): GmailSenderStatusViewModel {
	const discovering = input.discoveryPending || input.discovery.state === "running" || (input.discoveryStarted && input.discovery.state === "idle");
	const polling = discovering && input.pollCount < GMAIL_DISCOVERY_MAX_POLLS;
	const status = discoveryStatus(input, discovering);
	return {
		discoveryState: input.discovery.state,
		discoveryAfter: input.discoveryAfter,
		statusLead: status.lead,
		checkedLabel: status.checked,
		loadButtonLabel: polling ? (checkingForNewMessages(input) ? "Checking for new messages…" : "Checking…") : "Load senders",
		reconnectActions: input.discovery.requiresReconnect ? buildGmailConnectionPrompt({
			canConnectGmail: input.canConnectGmail,
			message: status.lead,
			content: "reconnect-sender-access", label: "Reconnect Gmail", variant: "neutral", fields: [],
			track: input.track,
		}).actions : [],
		refreshActions: refreshActions({ listed: input.listed, knownCount: input.knownCount }),
		pollUrl: polling ? input.pollUrl(input.pollCount + 1) : undefined,
		pollTrigger: polling ? discoveryPollTrigger(input.pollCount + 1) : undefined,
	};
}
