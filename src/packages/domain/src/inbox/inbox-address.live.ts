import { INBOX_ADDRESS_MAX_PER_USER, type InboxAddressPurpose } from "./inbox-address.schema";
import type { InboxAddressEntry } from "./inbox-address.types";

/** The one definition of "live" shared by the per-user cap (enforced in both
 * store adapters) and the page's limit banner, so the banner counts a slot the
 * same way the store decides whether to reject a create — the two can't silently
 * drift apart. "Live" is the absence of a `disabledAt` stamp: addresses are
 * disabled, never deleted (see {@link InboxAddressEntry}). */
export function isLiveAddress(entry: InboxAddressEntry): boolean {
	return entry.disabledAt === undefined;
}

const CAPPED_PURPOSES: Record<InboxAddressPurpose, boolean> = {
	"user-alias": true,
	"gmail-forwarding": false,
	"gmail-mapped": true,
	"gmail-readlist": false,
};

export function isCappedAddress(entry: InboxAddressEntry): boolean {
	return CAPPED_PURPOSES[entry.purpose];
}

export function countLiveCappedAddresses(entries: readonly InboxAddressEntry[]): number {
	return entries.filter((entry) => isLiveAddress(entry) && isCappedAddress(entry)).length;
}

export function addressCapReached(input: {
	purpose: InboxAddressPurpose;
	owned: readonly InboxAddressEntry[];
}): boolean {
	return (
		CAPPED_PURPOSES[input.purpose] &&
		countLiveCappedAddresses(input.owned) >= INBOX_ADDRESS_MAX_PER_USER
	);
}
