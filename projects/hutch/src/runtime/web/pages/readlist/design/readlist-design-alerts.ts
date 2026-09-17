import { READLIST_MAX_PER_USER } from "@packages/domain/readlist";

import {
	READLIST_ERROR_LIMIT,
	READLIST_ERROR_UNKNOWN_READLIST,
	READLIST_RENAME_REJECTIONS,
} from "../readlist.error";

export interface ReadlistDesignAlert {
	code: string;
	title: string;
	body: string;
}

const RENAME_ALERT_TITLE = "Couldn't rename the readlist";

const ALERTS: Record<string, Omit<ReadlistDesignAlert, "code">> = {
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

export function readlistDesignAlertFor(query: Record<string, unknown>): ReadlistDesignAlert | undefined {
	const code = typeof query.queue_error === "string" ? query.queue_error : undefined;
	if (code === undefined) return undefined;
	const alert = ALERTS[code];
	return alert === undefined ? undefined : { code, ...alert };
}
