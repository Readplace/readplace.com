import {
	EMAIL_LINK_ORDINAL_CAPACITY,
	EmailLinkOrdinalSchema,
	formatEmailLinkOrdinal,
} from "./inbox-email-link.schema";

describe("EmailLinkOrdinalSchema", () => {
	it("accepts a four-digit zero-padded ordinal", () => {
		expect(EmailLinkOrdinalSchema.parse("0000")).toBe("0000");
		expect(EmailLinkOrdinalSchema.parse("1999")).toBe("1999");
	});

	it("rejects ordinals that are not exactly four digits", () => {
		expect(EmailLinkOrdinalSchema.safeParse("12").success).toBe(false);
		expect(EmailLinkOrdinalSchema.safeParse("12345").success).toBe(false);
		expect(EmailLinkOrdinalSchema.safeParse("abcd").success).toBe(false);
	});
});

describe("formatEmailLinkOrdinal", () => {
	it("mints the last in-capacity index as a valid ordinal", () => {
		expect(() => formatEmailLinkOrdinal(EMAIL_LINK_ORDINAL_CAPACITY - 1)).not.toThrow();
	});

	it("refuses the first index past the capacity", () => {
		expect(() => formatEmailLinkOrdinal(EMAIL_LINK_ORDINAL_CAPACITY)).toThrow();
	});
});
