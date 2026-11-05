import { type UpgradeOffer, renderedLockFor } from "../../shared/upgrade-offer/upgrade-offer";
import { ACCOUNT_PLANS_URL } from "../account/account.url";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";
import { GMAIL_UPGRADE_MESSAGE } from "./gmail-connection-access";
import { type FormField, type GmailFormAction, trackGmail } from "./gmail-form-fields";

export interface GmailConnectionPrompt {
	message: string;
	actions: GmailFormAction[];
	locks: readonly string[];
}

interface GmailConnectionPromptInput {
	canConnectGmail: boolean;
	message: string;
	content: string;
	label: string;
	variant: GmailFormAction["variant"];
	fields: FormField[];
}

interface GmailConnectionLock {
	offer: UpgradeOffer | undefined;
	controlClass: string;
}

export function gmailConnectionPrompt(input: GmailConnectionPromptInput & { lock: GmailConnectionLock }): GmailConnectionPrompt {
	return buildLockableGmailConnectionPrompt({ ...input, track: ({ href, content }) => trackGmail(href, content) });
}

export function buildLockableGmailConnectionPrompt(
	input: GmailConnectionPromptInput & { lock: GmailConnectionLock; track: (link: { href: string; content: string }) => string },
): GmailConnectionPrompt {
	const prompt = buildGmailConnectionPrompt(input);
	const locks = renderedLockFor({
		offer: input.lock.offer,
		gated: !input.canConnectGmail,
		key: "connect-gmail",
		label: input.label,
		controlClass: input.lock.controlClass,
		source: "connectors",
	});
	return locks.length === 0 ? prompt : { message: prompt.message, actions: [], locks };
}

function buildGmailConnectionPrompt(
	input: GmailConnectionPromptInput & { track: (link: { href: string; content: string }) => string },
): GmailConnectionPrompt {
	if (input.canConnectGmail) {
		return {
			message: input.message,
			actions: [{
				key: input.content,
				method: "POST",
				action: input.track({ href: GMAIL_CONNECT_PATH, content: input.content }),
				label: input.label,
				variant: input.variant,
				fields: input.fields,
			}],
			locks: [],
		};
	}
	const action = input.track({ href: ACCOUNT_PLANS_URL, content: "upgrade-gmail" });
	return {
		message: GMAIL_UPGRADE_MESSAGE,
		actions: [{
			key: "upgrade-gmail",
			method: "GET",
			action,
			label: "Upgrade",
			variant: input.variant,
			fields: Array.from(new URL(action, "https://readplace.com").searchParams, ([name, value]) => ({ name, value })),
		}],
		locks: [],
	};
}
