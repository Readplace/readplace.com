import { ACCOUNT_PLANS_URL } from "../account/account.url";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";
import { GMAIL_UPGRADE_MESSAGE } from "./gmail-connection-access";
import { type FormField, type GmailFormAction, trackGmail } from "./gmail-form-fields";

export interface GmailConnectionPrompt {
	message: string;
	actions: GmailFormAction[];
}

interface GmailConnectionPromptInput {
	canConnectGmail: boolean;
	message: string;
	content: string;
	label: string;
	variant: GmailFormAction["variant"];
	fields: FormField[];
}

export function gmailConnectionPrompt(input: GmailConnectionPromptInput): GmailConnectionPrompt {
	return buildGmailConnectionPrompt({ ...input, track: ({ href, content }) => trackGmail(href, content) });
}

export function buildGmailConnectionPrompt(
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
	};
}
