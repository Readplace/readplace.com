import assert from "node:assert/strict";
import {
	aliasNameFromAddress,
	AliasNameSchema,
	buildInboxAddress,
	DEFAULT_INBOX_ALIAS,
	generateInboxToken,
	INBOX_ADDRESS_MAX_PER_USER,
	INBOX_TOKEN_LENGTH,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
	InboxTokenSchema,
	normalizeAliasName,
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

describe("AliasNameSchema", () => {
	it("accepts a lowercase alphanumeric label with single internal hyphens", () => {
		for (const value of ["netflix", "in", "my-newsletter", "abc123", "a1-b2-c3"]) {
			assert.equal(AliasNameSchema.parse(value), value);
		}
	});

	it("rejects labels that break the local-part rules", () => {
		for (const value of [
			"", // empty
			"-lead", // leading hyphen
			"trail-", // trailing hyphen
			"double--hyphen", // doubled hyphen
			"Upper", // uppercase
			"has space", // whitespace
			"emoji🎉", // non-alphanumeric
			"a".repeat(25), // over the 24-char cap
		]) {
			assert.equal(AliasNameSchema.safeParse(value).success, false, value);
		}
	});
});

describe("InboxAddressSchema", () => {
	it("accepts the new <alias>-<token> shape", () => {
		assert.equal(
			InboxAddressSchema.parse("netflix-a7b2c9@read.place"),
			"netflix-a7b2c9@read.place",
		);
		assert.equal(
			InboxAddressSchema.parse("my-newsletter-a7b2c9@read.place"),
			"my-newsletter-a7b2c9@read.place",
		);
	});

	it("still accepts the legacy in-<token> shape (alias = in)", () => {
		assert.equal(InboxAddressSchema.parse("in-3f9a2c@read.place"), "in-3f9a2c@read.place");
	});

	it("rejects an address without the trailing six-char token", () => {
		assert.equal(InboxAddressSchema.safeParse("netflix@read.place").success, false);
	});
});

describe("DEFAULT_INBOX_ALIAS", () => {
	it("is a valid alias so signup can mint inbox-<token>@…", () => {
		assert.equal(DEFAULT_INBOX_ALIAS, "inbox");
		assert.equal(AliasNameSchema.safeParse(DEFAULT_INBOX_ALIAS).success, true);
	});
});

describe("normalizeAliasName", () => {
	it("lowercases and keeps an already-clean label", () => {
		assert.equal(normalizeAliasName("Netflix"), "netflix");
	});

	it("collapses runs of non-alphanumerics to a single hyphen and trims the edges", () => {
		assert.equal(normalizeAliasName("  My   Newsletter!!  "), "my-newsletter");
		assert.equal(normalizeAliasName("--weird__name--"), "weird-name");
	});

	it("truncates to the 24-char cap without leaving a trailing hyphen", () => {
		const result = normalizeAliasName("a".repeat(30));
		assert.equal(result, "a".repeat(24));
		// A run whose truncation boundary lands on a hyphen still yields a clean label.
		assert.equal(normalizeAliasName(`${"a".repeat(23)} tail`), "a".repeat(23));
	});

	it("returns undefined when nothing valid survives", () => {
		assert.equal(normalizeAliasName(""), undefined);
		assert.equal(normalizeAliasName("   "), undefined);
		assert.equal(normalizeAliasName("🎉🎉"), undefined);
	});
});

describe("buildInboxAddress", () => {
	it("composes the alias name, token, and domain into an address", () => {
		const name = AliasNameSchema.parse("netflix");
		const token = InboxTokenSchema.parse("3f9a2c");
		assert.equal(
			buildInboxAddress({ name, token, domain: "read.place" }),
			"netflix-3f9a2c@read.place",
		);
	});

	it("uses the supplied domain so per-environment domains render correctly", () => {
		const name = AliasNameSchema.parse("in");
		const token = InboxTokenSchema.parse("abc123");
		assert.equal(
			buildInboxAddress({ name, token, domain: "staging.read.place" }),
			"in-abc123@staging.read.place",
		);
	});

	it("accepts a freshly generated token", () => {
		const address = buildInboxAddress({
			name: DEFAULT_INBOX_ALIAS,
			token: generateInboxToken(),
			domain: "read.place",
		});
		assert.match(address, /^inbox-[0-9a-z]{6}@read\.place$/);
	});
});

describe("aliasNameFromAddress", () => {
	it("recovers the alias from a new multi-segment address", () => {
		const address = InboxAddressSchema.parse("my-newsletter-a7b2c9@read.place");
		assert.equal(aliasNameFromAddress(address), "my-newsletter");
	});

	it("recovers the label from a legacy in-<token> address", () => {
		const address = InboxAddressSchema.parse("in-3f9a2c@read.place");
		assert.equal(aliasNameFromAddress(address), "in");
	});

	it("round-trips with buildInboxAddress", () => {
		const name = AliasNameSchema.parse("netflix");
		const token = InboxTokenSchema.parse("3f9a2c");
		assert.equal(aliasNameFromAddress(buildInboxAddress({ name, token, domain: "read.place" })), name);
	});
});

describe("InboxAddressLimitReachedError", () => {
	it("carries the cap it was raised against and names it in the message", () => {
		const error = new InboxAddressLimitReachedError(INBOX_ADDRESS_MAX_PER_USER);
		assert.ok(error instanceof Error);
		assert.equal(error.name, "InboxAddressLimitReachedError");
		assert.equal(error.limit, INBOX_ADDRESS_MAX_PER_USER);
		assert.match(error.message, new RegExp(String(INBOX_ADDRESS_MAX_PER_USER)));
	});
});
