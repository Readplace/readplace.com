import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import { countLiveAddresses, isLiveAddress } from "./inbox-address.live";
import { buildInboxAddress, generateInboxToken } from "./inbox-address.schema";
import type { InboxAddressEntry } from "./inbox-address.types";

function makeEntry(disabledAt: string | undefined): InboxAddressEntry {
	const token = generateInboxToken();
	return {
		address: buildInboxAddress({ token, domain: "read.place" }),
		userId: UserIdSchema.parse("user-1"),
		token,
		createdAt: "2026-01-01T00:00:00.000Z",
		disabledAt,
	};
}

describe("isLiveAddress", () => {
	it("treats an address with no disabledAt stamp as live", () => {
		assert.equal(isLiveAddress(makeEntry(undefined)), true);
	});

	it("treats a disabled address as not live", () => {
		assert.equal(isLiveAddress(makeEntry("2026-01-02T00:00:00.000Z")), false);
	});
});

describe("countLiveAddresses", () => {
	it("counts only the entries without a disabledAt stamp", () => {
		const entries = [
			makeEntry(undefined),
			makeEntry("2026-01-02T00:00:00.000Z"),
			makeEntry(undefined),
		];
		assert.equal(countLiveAddresses(entries), 2);
	});

	it("returns zero when every address is disabled", () => {
		assert.equal(countLiveAddresses([makeEntry("2026-01-02T00:00:00.000Z")]), 0);
	});

	it("returns zero for an empty list", () => {
		assert.equal(countLiveAddresses([]), 0);
	});
});
