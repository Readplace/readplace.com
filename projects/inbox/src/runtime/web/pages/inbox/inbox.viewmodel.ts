import { type InboxAddressEntry, isLiveAddress } from "@packages/domain/inbox";

export interface InboxAddressRowViewModel {
	address: string;
	name: string;
	addressAriaLabel: string;
	copyAriaLabel: string;
	disableAriaLabel: string;
}

export interface InboxAddressesViewModel {
	hasAddresses: boolean;
	activeAddresses: InboxAddressRowViewModel[];
	disabledAddresses: InboxAddressRowViewModel[];
	hasDisabled: boolean;
	disabledCount: number;
}

function toRow(entry: InboxAddressEntry): InboxAddressRowViewModel {
	return {
		address: entry.address,
		name: entry.name,
		addressAriaLabel: `Inbox email: ${entry.name}`,
		copyAriaLabel: `Copy inbox email: ${entry.name}`,
		disableAriaLabel: `Disable inbox email: ${entry.name}`,
	};
}

export function toInboxAddressesViewModel(entries: InboxAddressEntry[]): InboxAddressesViewModel {
	const activeAddresses = entries.filter(isLiveAddress).map(toRow);
	const disabledAddresses = entries.filter((entry) => !isLiveAddress(entry)).map(toRow);
	return {
		hasAddresses: entries.length > 0,
		activeAddresses,
		disabledAddresses,
		hasDisabled: disabledAddresses.length > 0,
		disabledCount: disabledAddresses.length,
	};
}
