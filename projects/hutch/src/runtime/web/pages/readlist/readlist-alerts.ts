import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";
import type { AlertContent } from "@packages/web-shell";

import {
	READLIST_ERROR_LIMIT,
	READLIST_ERROR_UNKNOWN_READLIST,
	READLIST_RENAME_REJECTIONS,
} from "./readlist.error";

const RENAME_ALERT_TITLE = "Couldn't rename the readlist";

const ALERTS: Record<string, { title: string; body: string }> = {
	[READLIST_ERROR_LIMIT]: {
		title: "Readlist limit reached",
		body: `You can create up to ${READLIST_MAX_PER_USER} readlists. Delete an existing readlist before creating a new one.`,
	},
	[READLIST_ERROR_UNKNOWN_READLIST]: {
		title: "Readlist not found",
		body: "This readlist no longer exists. Select another readlist to continue.",
	},
	...Object.fromEntries(
		Object.entries(READLIST_RENAME_REJECTIONS).map(([reason, rejection]) => [
			`rename_${reason}`,
			{ title: RENAME_ALERT_TITLE, body: rejection.message },
		]),
	),
};

export const INBOX_UNAVAILABLE_ALERT: AlertContent = {
	variant: "error",
	title: { text: "That inbox isn't available", element: "p" },
	message: { text: "It may have been turned off. Pick another inbox." },
};

export function readlistAlertFor(query: Record<string, unknown>): AlertContent | undefined {
	const code = typeof query.queue_error === "string" ? query.queue_error : undefined;
	if (code === undefined) return undefined;
	const alert = ALERTS[code];
	return alert === undefined
		? undefined
		: {
				variant: "error",
				title: { text: alert.title, element: "p" },
				message: { text: alert.body },
			};
}
