import {
	INBOX_ADDRESS_MAX_PER_USER,
	type InboxAddressEntry,
	isLiveAddress,
	isCappedAddress,
} from "@packages/domain/inbox";

export interface InboxAddressRowViewModel {
	address: string;
	name: string;
	addressAriaLabel: string;
	copyAriaLabel: string;
	disableAriaLabel: string;
}

export type InboxAlertKey = "create-failed" | "limit";

export interface InboxAlertViewModel {
	key: InboxAlertKey;
	title: string;
	body: string;
}

export type InboxNameErrorKey = "name-invalid" | "name-taken";

export interface InboxNameErrorViewModel {
	key: InboxNameErrorKey;
	message: string;
}

export interface InboxAddressesViewModel {
	hasAddresses: boolean;
	/** Both the list and the empty line always render; this says which one the
	 * reader is looking at, so a test asserts the state rather than an absence. */
	addressesState: "list" | "empty";
	showsListing: boolean;
	activeAddresses: InboxAddressRowViewModel[];
	disabledAddresses: InboxAddressRowViewModel[];
	hasDisabled: boolean;
	disabledCount: number;
}

const ALERTS: Record<InboxAlertKey, Omit<InboxAlertViewModel, "key">> = {
	"create-failed": {
		title: "Couldn't create an inbox email",
		body: "Try again in a moment.",
	},
	limit: {
		title: "Inbox email limit reached",
		body: `You've reached the maximum of ${INBOX_ADDRESS_MAX_PER_USER} inbox emails. Disable any you no longer need before enabling or creating more.`,
	},
};

const NAME_ERROR_MESSAGES: Record<InboxNameErrorKey, string> = {
	"name-invalid":
		"Give the inbox email a name using letters, numbers, and hyphens — for example, my-newsletter.",
	"name-taken": "You already have an active inbox email with that name. Pick a different one.",
};

/** The alerts the page is showing, in the order they render. Built here rather
 * than branched in the template so adding one is a map entry and a push, and so
 * a test can assert the whole set a reader sees rather than probing for each. */
export function toInboxAlerts(input: {
	createFailed: boolean;
	limitReached: boolean;
}): InboxAlertViewModel[] {
	const keys: InboxAlertKey[] = [];
	if (input.createFailed) keys.push("create-failed");
	if (input.limitReached) keys.push("limit");
	return keys.map((key) => ({ key, ...ALERTS[key] }));
}

export function toInboxNameErrors(input: {
	nameInvalid: boolean;
	nameTaken: boolean;
}): InboxNameErrorViewModel[] {
	const keys: InboxNameErrorKey[] = [];
	if (input.nameInvalid) keys.push("name-invalid");
	if (input.nameTaken) keys.push("name-taken");
	return keys.map((key) => ({ key, message: NAME_ERROR_MESSAGES[key] }));
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
	const aliases = entries.filter(isCappedAddress);
	const activeAddresses = aliases.filter(isLiveAddress).map(toRow);
	const disabledAddresses = aliases.filter((entry) => !isLiveAddress(entry)).map(toRow);
	return {
		hasAddresses: aliases.length > 0,
		addressesState: aliases.length > 0 ? "list" : "empty",
		showsListing: activeAddresses.length > 0 || aliases.length === 0,
		activeAddresses,
		disabledAddresses,
		hasDisabled: disabledAddresses.length > 0,
		disabledCount: disabledAddresses.length,
	};
}
