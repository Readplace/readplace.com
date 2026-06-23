import type { UserId } from "../user";
import type { InboxAddress, InboxToken } from "./inbox-address.schema";

/** One forwarding address owned by a user. Addresses are never deleted — a hash
 * that was once minted for one user must never be re-mintable for another, or
 * their forwarded mail could leak — so disabling sets `disabledAt` and the row
 * stays. `disabledAt === undefined` means the address is live. */
export interface InboxAddressEntry {
	address: InboxAddress;
	userId: UserId;
	token: InboxToken;
	createdAt: string;
	disabledAt: string | undefined;
}

export interface InboxAddressStore {
	/** Mints a fresh address for the user. A user may hold many (one per
	 * newsletter). Guards global uniqueness with a conditional put + bounded
	 * retry; throws on retry exhaustion so the failure surfaces to alerting. */
	createAddress: (input: { userId: UserId; domain: string }) => Promise<InboxAddressEntry>;
	listAddressesByUserId: (userId: UserId) => Promise<InboxAddressEntry[]>;
	disableAddress: (input: { userId: UserId; address: InboxAddress }) => Promise<void>;
}
