import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import {
	countLiveAddresses,
	countLiveUserAliases,
	isLiveAddress,
	isUserAlias,
	userAliasCapReached,
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

describe("isUserAlias", () => {
	it("treats an address the user minted as a user alias", () => {
		assert.equal(isUserAlias(makeEntry()), true);
	});

	it("treats the Gmail gateway address as not a user alias", () => {
		assert.equal(isUserAlias(makeEntry({ purpose: "gmail-forwarding" })), false);
	});
});

describe("countLiveUserAliases", () => {
	it("counts only live addresses the user minted themselves", () => {
		const entries = [
			makeEntry(),
			makeEntry({ purpose: "gmail-forwarding" }),
			makeEntry({ purpose: "gmail-mapped" }),
			makeEntry({ disabledAt: DISABLED_AT }),
		];
		assert.equal(countLiveUserAliases(entries), 1);
	});

	it("returns zero when the user holds only integration-minted addresses", () => {
		assert.equal(countLiveUserAliases([makeEntry({ purpose: "gmail-forwarding" })]), 0);
	});
});

describe("userAliasCapReached", () => {
	it("reaches the cap for a user alias once the user holds the maximum live user aliases", () => {
		const owned = liveUserAliases(INBOX_ADDRESS_MAX_PER_USER);
		assert.equal(userAliasCapReached({ purpose: "user-alias", owned }), true);
	});

	it("leaves room for a user alias when one of the cap-worth of rows is disabled", () => {
		const owned = [
			...liveUserAliases(INBOX_ADDRESS_MAX_PER_USER - 1),
			makeEntry({ disabledAt: DISABLED_AT }),
		];
		assert.equal(userAliasCapReached({ purpose: "user-alias", owned }), false);
	});

	it("never caps the Gmail gateway address, even when the user aliases are full", () => {
		const owned = liveUserAliases(INBOX_ADDRESS_MAX_PER_USER);
		assert.equal(userAliasCapReached({ purpose: "gmail-forwarding", owned }), false);
	});

	it("never caps a Gmail-mapped inbox, even when the user aliases are full", () => {
		const owned = liveUserAliases(INBOX_ADDRESS_MAX_PER_USER);
		assert.equal(userAliasCapReached({ purpose: "gmail-mapped", owned }), false);
	});

	it("does not count integration-minted rows toward a user alias's cap", () => {
		const owned = [
			...liveUserAliases(INBOX_ADDRESS_MAX_PER_USER - 1),
			makeEntry({ purpose: "gmail-mapped" }),
		];
		assert.equal(userAliasCapReached({ purpose: "user-alias", owned }), false);
	});
});
