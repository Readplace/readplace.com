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

export function countLiveAddresses(entries: readonly InboxAddressEntry[]): number {
	return entries.filter(isLiveAddress).length;
}

export function isUserAlias(entry: InboxAddressEntry): boolean {
	return entry.purpose === "user-alias";
}

export function countLiveUserAliases(entries: readonly InboxAddressEntry[]): number {
	return entries.filter((entry) => isLiveAddress(entry) && isUserAlias(entry)).length;
}

export function userAliasCapReached(input: {
	purpose: InboxAddressPurpose;
	owned: readonly InboxAddressEntry[];
}): boolean {
	return (
		input.purpose === "user-alias" && countLiveUserAliases(input.owned) >= INBOX_ADDRESS_MAX_PER_USER
	);
}
