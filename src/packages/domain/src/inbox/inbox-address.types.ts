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
	 * newsletter) up to `INBOX_ADDRESS_MAX_PER_USER`; at the cap it throws
	 * `InboxAddressLimitReachedError` so callers can surface a friendly limit
	 * message. Guards global uniqueness with a conditional put + bounded retry;
	 * throws on retry exhaustion so the failure surfaces to alerting. */
	createAddress: (input: { userId: UserId; domain: string }) => Promise<InboxAddressEntry>;
	/** Every address the user owns (1:N). The production adapter reads a DynamoDB
	 * GSI, which is eventually consistent — an address created moments earlier may
	 * be absent from the result — so callers must not assume read-your-write. The
	 * in-memory fixture is strongly consistent and so will not surface the lag. */
	listAddressesByUserId: (userId: UserId) => Promise<InboxAddressEntry[]>;
	/** Stamps `disabledAt` on an address the user owns. The write is
	 * ownership-guarded: disabling an address that does not exist or belongs to
	 * another user throws `ConditionalCheckFailedException` rather than silently
	 * succeeding, so a forged address can never reach a foreign row. */
	disableAddress: (input: { userId: UserId; address: InboxAddress }) => Promise<void>;
	/** Resolve a forwarding address to its owner. A single strongly-consistent
	 * GetItem on the `address` partition key — not the eventually-consistent GSI
	 * that `listAddressesByUserId` reads — so the receive path never races a
	 * just-minted address. Returns `undefined` for an unknown address; a returned
	 * entry with `disabledAt !== undefined` means the caller must reject the mail. */
	findByAddress: (address: InboxAddress) => Promise<InboxAddressEntry | undefined>;
}
