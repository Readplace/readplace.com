import assert from "node:assert/strict";
import {
	buildInboxAddress,
	generateInboxToken,
	INBOX_TOKEN_LENGTH,
	InboxTokenSchema,
} from "./inbox-address.schema";

describe("generateInboxToken", () => {
	it("produces a six-character lowercase base36 token", () => {
		const token = generateInboxToken();
		assert.match(token, /^[0-9a-z]{6}$/);
		assert.equal(token.length, INBOX_TOKEN_LENGTH);
	});

	it("returns a value the token schema accepts", () => {
		const token = generateInboxToken();
		assert.equal(InboxTokenSchema.parse(token), token);
	});
});

describe("buildInboxAddress", () => {
	it("composes the local-part prefix, token, and domain into an address", () => {
		const token = InboxTokenSchema.parse("3f9a2c");
		assert.equal(
			buildInboxAddress({ token, domain: "read.place" }),
			"in-3f9a2c@read.place",
		);
	});

	it("uses the supplied domain so per-environment domains render correctly", () => {
		const token = InboxTokenSchema.parse("abc123");
		assert.equal(
			buildInboxAddress({ token, domain: "staging.read.place" }),
			"in-abc123@staging.read.place",
		);
	});

	it("accepts a freshly generated token", () => {
		const address = buildInboxAddress({ token: generateInboxToken(), domain: "read.place" });
		assert.match(address, /^in-[0-9a-z]{6}@read\.place$/);
	});
});
