import {
	INBOX_ADDRESS_MAX_PER_USER,
	type InboxAddressEntry,
	isLiveAddress,
} from "@packages/domain/inbox";

export interface InboxAddressRowViewModel {
	address: string;
	name: string;
	addressAriaLabel: string;
	copyAriaLabel: string;
	disableAriaLabel: string;
}

export type InboxAlertKey = "create-failed" | "name-invalid" | "name-taken" | "limit";

export interface InboxAlertViewModel {
	key: InboxAlertKey;
	message: string;
	/** The stable id the name input's aria-describedby points at. Only the two
	 * field-level complaints about the typed value carry it, and the route derives
	 * them from a single `error` query value, so at most one alert renders it. */
	id: "inbox-name-error" | undefined;
}

export interface InboxAddressesViewModel {
	hasAddresses: boolean;
	/** Both the list and the empty line always render; this says which one the
	 * reader is looking at, so a test asserts the state rather than an absence. */
	addressesState: "list" | "empty";
	activeAddresses: InboxAddressRowViewModel[];
	disabledAddresses: InboxAddressRowViewModel[];
	hasDisabled: boolean;
	disabledCount: number;
}

const ALERT_MESSAGES: Record<InboxAlertKey, string> = {
	"create-failed": "I couldn't create an inbox email just now — try again in a moment.",
	"name-invalid":
		"Give the inbox email a name using letters, numbers, and hyphens — for example, my-newsletter.",
	"name-taken": "You already have an active inbox email with that name. Pick a different one.",
	limit: `You've reached the maximum of ${INBOX_ADDRESS_MAX_PER_USER} inbox emails. Disable any you no longer need before enabling or creating more.`,
};

/** The alerts the page is showing, in the order they render. Built here rather
 * than branched in the template so adding one is a map entry and a push, and so
 * a test can assert the whole set a reader sees rather than probing for each. */
export function toInboxAlerts(input: {
	createFailed: boolean;
	nameInvalid: boolean;
	nameTaken: boolean;
	limitReached: boolean;
}): InboxAlertViewModel[] {
	const keys: InboxAlertKey[] = [];
	if (input.createFailed) keys.push("create-failed");
	if (input.nameInvalid) keys.push("name-invalid");
	if (input.nameTaken) keys.push("name-taken");
	if (input.limitReached) keys.push("limit");
	return keys.map((key) => ({
		key,
		message: ALERT_MESSAGES[key],
		id: key === "name-invalid" || key === "name-taken" ? "inbox-name-error" : undefined,
	}));
}

export function toInboxAddressAriaLabels(name: string): {
	addressAriaLabel: string;
	copyAriaLabel: string;
} {
	return {
		addressAriaLabel: `Inbox email: ${name}`,
		copyAriaLabel: `Copy inbox email: ${name}`,
	};
}

function toRow(entry: InboxAddressEntry): InboxAddressRowViewModel {
	return {
		address: entry.address,
		name: entry.name,
		...toInboxAddressAriaLabels(entry.name),
		disableAriaLabel: `Disable inbox email: ${entry.name}`,
	};
}

export function toInboxAddressesViewModel(entries: InboxAddressEntry[]): InboxAddressesViewModel {
	const activeAddresses = entries.filter(isLiveAddress).map(toRow);
	const disabledAddresses = entries.filter((entry) => !isLiveAddress(entry)).map(toRow);
	return {
		hasAddresses: entries.length > 0,
		addressesState: entries.length > 0 ? "list" : "empty",
		activeAddresses,
		disabledAddresses,
		hasDisabled: disabledAddresses.length > 0,
		disabledCount: disabledAddresses.length,
	};
}
