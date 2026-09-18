import type { UserId } from "../user";
import type {
	AliasName,
	InboxAddress,
	InboxAddressPurpose,
	InboxToken,
} from "./inbox-address.schema";

/** One forwarding address owned by a user. Addresses are never deleted — a hash
 * that was once minted for one user must never be re-mintable for another, or
 * their forwarded mail could leak — so disabling sets `disabledAt` and the row
 * stays. `disabledAt === undefined` means the address is live. `name` is the
 * user-chosen label (the alias prefix); for a legacy `in-<token>` row minted
 * before the column existed it is derived from the address on read. */
export interface InboxAddressEntry {
	address: InboxAddress;
	userId: UserId;
	name: AliasName;
	token: InboxToken;
	createdAt: string;
	disabledAt: string | undefined;
	purpose: InboxAddressPurpose;
}

/** Account-deletion primitive: unlinks every address the user owns from them
 * without deleting any row (a freed hash could be re-minted for another user and
 * leak their forwarded mail). For each owned address it strips the PII alias,
 * repoints `userId` at the reserved `DELETED_ACCOUNT_INBOX_OWNER` sentinel, and
 * stamps `disabledAt` if not already set. Ownership-guarded per row. */
export type TombstoneUserAddresses = (userId: UserId) => Promise<void>;

export interface InboxAddressStore {
	/** Mints a fresh address for the user under the chosen alias `name`. A user
	 * may hold many (one per newsletter). Only the random token is regenerated on collision,
	 * so global uniqueness of the full address is guarded with a conditional put +
	 * bounded retry; throws on retry exhaustion so the failure surfaces to
	 * alerting. Two users may hold the same `name` — the token keeps their
	 * addresses distinct. */
	createAddress: (input: {
		userId: UserId;
		domain: string;
		name: AliasName;
		purpose: InboxAddressPurpose;
	}) => Promise<InboxAddressEntry>;
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
	/** Clears `disabledAt`, returning an address the user owns to live. Guarded
	 * exactly like {@link disableAddress}: a tombstoned row's sentinel `userId`
	 * fails the ownership condition, so a deleted-account address can never be
	 * resurrected and a forged address can never reach a foreign row. */
	enableAddress: (input: { userId: UserId; address: InboxAddress }) => Promise<void>;
	/** Resolve a forwarding address to its owner. A single strongly-consistent
	 * GetItem on the `address` partition key — not the eventually-consistent GSI
	 * that `listAddressesByUserId` reads — so the receive path never races a
	 * just-minted address. Returns `undefined` for an unknown address; a returned
	 * entry with `disabledAt !== undefined` means the caller must reject the mail. */
	findByAddress: (address: InboxAddress) => Promise<InboxAddressEntry | undefined>;
	/** Tombstones every address the user owns as part of account deletion. See
	 * {@link TombstoneUserAddresses}. */
	tombstoneUserAddresses: TombstoneUserAddresses;
}
