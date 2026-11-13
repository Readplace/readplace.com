import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import { decideAliasName } from "./inbox-address-name";
import {
	AliasNameSchema,
	InboxAddressSchema,
	type InboxAddressPurpose,
	InboxTokenSchema,
} from "./inbox-address.schema";
import type { InboxAddressEntry } from "./inbox-address.types";

function inbox(input: { name: string; purpose?: InboxAddressPurpose; disabledAt?: string }): InboxAddressEntry {
	return {
		address: InboxAddressSchema.parse(`${input.name}-abc123@read.place`),
		userId: UserIdSchema.parse("user-1"),
		name: AliasNameSchema.parse(input.name),
		token: InboxTokenSchema.parse("abc123"),
		createdAt: "2026-09-01T00:00:00.000Z",
		disabledAt: input.disabledAt,
		purpose: input.purpose ?? "user-alias",
		readlist: undefined,
	};
}

describe("decideAliasName", () => {
	it("accepts a free name in its normalised form", () => {
		assert.deepEqual(decideAliasName({ requested: "Work Reading", owned: [] }), {
			ok: true,
			name: "work-reading",
		});
	});

	it("rejects a name with no letters or digits", () => {
		assert.deepEqual(decideAliasName({ requested: "  🎉 ", owned: [] }), { ok: false, reason: "invalid-name" });
	});

	it("rejects a name a live custom email already uses, carrying the normalised name", () => {
		assert.deepEqual(decideAliasName({ requested: "News", owned: [inbox({ name: "news" })] }), {
			ok: false,
			reason: "name-taken",
			name: "news",
		});
	});

	it("rejects a name a live gmail-mapped address already uses", () => {
		const owned = [inbox({ name: "news", purpose: "gmail-mapped" })];
		assert.equal(decideAliasName({ requested: "news", owned }).ok, false);
	});

	it("reuses the name of a disabled custom email", () => {
		const owned = [inbox({ name: "news", disabledAt: "2026-09-02T00:00:00.000Z" })];
		assert.deepEqual(decideAliasName({ requested: "news", owned }), { ok: true, name: "news" });
	});

	it("ignores the name of an uncapped address", () => {
		const owned = [inbox({ name: "gmail", purpose: "gmail-forwarding" })];
		assert.deepEqual(decideAliasName({ requested: "gmail", owned }), { ok: true, name: "gmail" });
	});
});
