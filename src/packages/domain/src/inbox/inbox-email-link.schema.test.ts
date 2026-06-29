import {
	EmailLinkOrdinalSchema,
	EmailLinkStatusSchema,
	MAX_EMAIL_LINKS_PER_EMAIL,
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

describe("MAX_EMAIL_LINKS_PER_EMAIL", () => {
	const ordinalFor = (index: number) => String(index).padStart(4, "0");

	it("is the largest cap whose last index still parses", () => {
		expect(EmailLinkOrdinalSchema.safeParse(ordinalFor(MAX_EMAIL_LINKS_PER_EMAIL - 1)).success).toBe(
			true,
		);
	});

	it("rejects the first index a one-larger cap would mint", () => {
		expect(EmailLinkOrdinalSchema.safeParse(ordinalFor(MAX_EMAIL_LINKS_PER_EMAIL)).success).toBe(
			false,
		);
	});
});

describe("EmailLinkStatusSchema", () => {
	it("accepts the three lifecycle states", () => {
		expect(EmailLinkStatusSchema.parse("pending")).toBe("pending");
		expect(EmailLinkStatusSchema.parse("crawled")).toBe("crawled");
		expect(EmailLinkStatusSchema.parse("failed")).toBe("failed");
	});

	it("rejects an unknown state", () => {
		expect(EmailLinkStatusSchema.safeParse("staging").success).toBe(false);
	});
});
