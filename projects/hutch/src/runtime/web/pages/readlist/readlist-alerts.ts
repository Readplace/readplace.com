import type { AlertContent } from "@packages/web-shell";

import { SAVE_QUEUED_NOTICE } from "../../api/save-queued-siren";
import {
	READLIST_CREATE_REJECTIONS,
	READLIST_ERROR_LIMIT,
	READLIST_ERROR_UNKNOWN_READLIST,
	READLIST_LIMIT_MESSAGE,
	READLIST_NOTICE_SAVE_QUEUED,
	READLIST_RENAME_REJECTIONS,
} from "./readlist.error";

const RENAME_ALERT_TITLE = "Couldn't rename the readlist";

const CREATE_ALERT_TITLE = "Couldn't create the readlist";

function errorAlert(alert: { title: string; body: string }): AlertContent {
	return {
		variant: "error",
		title: { text: alert.title, element: "p" },
		message: { text: alert.body },
	};
}

const ALERTS: Record<string, AlertContent> = {
	[READLIST_ERROR_LIMIT]: errorAlert({
		title: "Readlist limit reached",
		body: READLIST_LIMIT_MESSAGE,
	}),
	[READLIST_ERROR_UNKNOWN_READLIST]: errorAlert({
		title: "Readlist not found",
		body: "This readlist no longer exists. Select another readlist to continue.",
	}),
	[READLIST_NOTICE_SAVE_QUEUED]: { variant: "info", message: { text: SAVE_QUEUED_NOTICE } },
	...Object.fromEntries(
		Object.entries(READLIST_RENAME_REJECTIONS).map(([reason, rejection]) => [
			`rename_${reason}`,
			errorAlert({ title: RENAME_ALERT_TITLE, body: rejection.message }),
		]),
	),
	...Object.fromEntries(
		Object.entries(READLIST_CREATE_REJECTIONS).map(([reason, rejection]) => [
			`create_${reason}`,
			errorAlert({ title: CREATE_ALERT_TITLE, body: rejection.message }),
		]),
	),
};

export const INBOX_UNAVAILABLE_ALERT: AlertContent = {
	variant: "error",
	title: { text: "That custom email isn't available", element: "p" },
	message: { text: "It may have been disabled. Pick another custom email." },
};

export const EMAIL_DELIVERY_INVALID_ALERT: AlertContent = errorAlert({
	title: "That choice isn't one Readplace offers",
	body: "Pick what to save from each email and try again.",
});

const GMAIL_SAVE_ALERT_TITLE = "Couldn't save the Gmail newsletters";

export const GMAIL_SELECTION_ALERT: AlertContent = errorAlert({
	title: GMAIL_SAVE_ALERT_TITLE,
	body: "One of those senders can't be saved here. Check it on the Gmail newsletters page, then try again.",
});

export const GMAIL_UNAVAILABLE_ALERT: AlertContent = errorAlert({
	title: GMAIL_SAVE_ALERT_TITLE,
	body: "Gmail isn't ready to save newsletters right now. Nothing was changed.",
});

export function readlistAlertFor(query: Record<string, unknown>): AlertContent | undefined {
	const code = typeof query.queue_error === "string" ? query.queue_error : undefined;
	if (code === undefined) return undefined;
	return Object.hasOwn(ALERTS, code) ? ALERTS[code] : undefined;
}
