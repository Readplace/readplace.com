import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import {
	addressCapReached,
	countLiveAddresses,
	countLiveCappedAddresses,
	isLiveAddress,
	isCappedAddress,
} from "./inbox-address.live";
import {
	AliasNameSchema,
	buildInboxAddress,
	DEFAULT_INBOX_ADDRESS_PURPOSE,
	generateInboxToken,
	INBOX_ADDRESS_MAX_PER_USER,
	type InboxAddressPurpose,
} from "./inbox-address.schema";
import type { InboxAddressEntry } from "./inbox-address.types";

const NAME = AliasNameSchema.parse("news");
const DISABLED_AT = "2026-01-02T00:00:00.000Z";

function makeEntry(
	input: { disabledAt?: string; purpose?: InboxAddressPurpose } = {},
): InboxAddressEntry {
	const token = generateInboxToken();
	return {
		address: buildInboxAddress({ name: NAME, token, domain: "read.place" }),
		userId: UserIdSchema.parse("user-1"),
		name: NAME,
		token,
		createdAt: "2026-01-01T00:00:00.000Z",
		disabledAt: input.disabledAt,
		purpose: input.purpose ?? DEFAULT_INBOX_ADDRESS_PURPOSE,
		gmailConfirmedAt: undefined,
	};
}

function liveUserAliases(count: number): InboxAddressEntry[] {
	return Array.from({ length: count }, () => makeEntry());
}

describe("isLiveAddress", () => {
	it("treats an address with no disabledAt stamp as live", () => {
		assert.equal(isLiveAddress(makeEntry()), true);
	});

	it("treats a disabled address as not live", () => {
		assert.equal(isLiveAddress(makeEntry({ disabledAt: DISABLED_AT })), false);
	});
});

describe("countLiveAddresses", () => {
	it("counts only the entries without a disabledAt stamp", () => {
		const entries = [makeEntry(), makeEntry({ disabledAt: DISABLED_AT }), makeEntry()];
		assert.equal(countLiveAddresses(entries), 2);
	});

	it("returns zero when every address is disabled", () => {
		assert.equal(countLiveAddresses([makeEntry({ disabledAt: DISABLED_AT })]), 0);
	});

	it("returns zero for an empty list", () => {
		assert.equal(countLiveAddresses([]), 0);
	});
});

describe("isCappedAddress", () => {
	it("includes user aliases and named Gmail inboxes", () => {
		assert.equal(isCappedAddress(makeEntry()), true);
		assert.equal(isCappedAddress(makeEntry({ purpose: "gmail-mapped" })), true);
	});

	it("exempts the Gmail gateway address", () => {
		assert.equal(isCappedAddress(makeEntry({ purpose: "gmail-forwarding" })), false);
	});
});

describe("countLiveCappedAddresses", () => {
	it("counts every live address except the Gmail gateway", () => {
		const entries = [
			makeEntry(),
			makeEntry({ purpose: "gmail-forwarding" }),
			makeEntry({ purpose: "gmail-mapped" }),
			makeEntry({ disabledAt: DISABLED_AT }),
		];
		assert.equal(countLiveCappedAddresses(entries), 2);
	});

	it("returns zero when the user holds only the exempt gateway", () => {
		assert.equal(countLiveCappedAddresses([makeEntry({ purpose: "gmail-forwarding" })]), 0);
	});
});

describe("addressCapReached", () => {
	it("reaches the cap for a user alias once the user holds the maximum live capped addresses", () => {
		const owned = liveUserAliases(INBOX_ADDRESS_MAX_PER_USER);
		assert.equal(addressCapReached({ purpose: "user-alias", owned }), true);
	});

	it("leaves room for a user alias when one of the cap-worth of rows is disabled", () => {
		const owned = [
			...liveUserAliases(INBOX_ADDRESS_MAX_PER_USER - 1),
			makeEntry({ disabledAt: DISABLED_AT }),
		];
		assert.equal(addressCapReached({ purpose: "user-alias", owned }), false);
	});

	it("never caps the Gmail gateway address, even when the cap is full", () => {
		const owned = liveUserAliases(INBOX_ADDRESS_MAX_PER_USER);
		assert.equal(addressCapReached({ purpose: "gmail-forwarding", owned }), false);
	});

	it("caps a Gmail-mapped inbox once the cap is full, since it now counts", () => {
		const owned = liveUserAliases(INBOX_ADDRESS_MAX_PER_USER);
		assert.equal(addressCapReached({ purpose: "gmail-mapped", owned }), true);
	});

	it("counts a Gmail-mapped row toward the cap alongside user aliases", () => {
		const owned = [
			...liveUserAliases(INBOX_ADDRESS_MAX_PER_USER - 1),
			makeEntry({ purpose: "gmail-mapped" }),
		];
		assert.equal(addressCapReached({ purpose: "user-alias", owned }), true);
	});
});
