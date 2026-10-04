import { ACCOUNT_PLANS_URL } from "../account/account.url";
import { GMAIL_CONNECT_PATH } from "./gmail-connect.url";
import { GMAIL_UPGRADE_MESSAGE } from "./gmail-connection-access";
import { type FormField, type GmailFormAction, trackGmail } from "./gmail-form-fields";

export interface GmailConnectionPrompt {
	message: string;
	actions: GmailFormAction[];
}

export function gmailConnectionPrompt(input: {
	canConnectGmail: boolean;
	message: string;
	content: string;
	label: string;
	variant: GmailFormAction["variant"];
	fields: FormField[];
}): GmailConnectionPrompt {
	if (input.canConnectGmail) {
		return {
			message: input.message,
			actions: [{
				key: input.content,
				method: "POST",
				action: trackGmail(GMAIL_CONNECT_PATH, input.content),
				label: input.label,
				variant: input.variant,
				fields: input.fields,
			}],
		};
	}
	const action = trackGmail(ACCOUNT_PLANS_URL, "upgrade-gmail");
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
