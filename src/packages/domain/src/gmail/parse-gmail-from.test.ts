import assert from "node:assert/strict";
import { parseGmailFrom } from "./parse-gmail-from";

describe("parseGmailFrom", () => {
	it("normalizes addresses and decodes quoted and encoded display names", () => {
		assert.deepEqual(parseGmailFrom('"Doe, Jane" <JANE@Example.COM>, =?UTF-8?B?Sm9zw6k=?= <jose@example.com>'), [
			{ email: "jane@example.com", name: "Doe, Jane" },
			{ email: "jose@example.com", name: "José" },
		]);
	});

	it("keeps bare addresses and flattens RFC mailbox groups", () => {
		assert.deepEqual(parseGmailFrom("Readers: sender@example.com, News <news@example.com>;"), [
			{ email: "sender@example.com", name: undefined },
			{ email: "news@example.com", name: "News" },
		]);
	});

	it("discards empty and invalid sender headers", () => {
		assert.deepEqual(parseGmailFrom(""), []);
		assert.deepEqual(parseGmailFrom("broken sender, -bad@example.com"), []);
	});
});
