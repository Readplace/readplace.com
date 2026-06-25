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
