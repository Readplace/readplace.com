import { canonicalizeEmail } from "./canonicalize-email";
import type { CanonicalEmail } from "./canonicalize-email";

describe("canonicalizeEmail (identity key)", () => {
	describe("collapses Gmail spellings of a single mailbox to one key", () => {
		it("ignores dots in the local part", () => {
			expect(canonicalizeEmail("john.doe@gmail.com")).toBe("johndoe@gmail.com");
			expect(canonicalizeEmail("j.o.h.n.d.o.e@gmail.com")).toBe("johndoe@gmail.com");
			expect(canonicalizeEmail("johndoe@gmail.com")).toBe("johndoe@gmail.com");
		});

		it("drops +tags", () => {
			expect(canonicalizeEmail("johndoe+a@gmail.com")).toBe("johndoe@gmail.com");
			expect(canonicalizeEmail("johndoe+a+b@gmail.com")).toBe("johndoe@gmail.com");
		});

		it("drops a +tag regardless of the characters inside it", () => {
			expect(canonicalizeEmail("johndoe+my_tag@gmail.com")).toBe("johndoe@gmail.com");
		});

		it("treats googlemail.com as gmail.com", () => {
			expect(canonicalizeEmail("johndoe@googlemail.com")).toBe("johndoe@gmail.com");
		});

		it("combines dots, tags, case and googlemail.com", () => {
			expect(canonicalizeEmail("John.Doe+work@googlemail.com")).toBe("johndoe@gmail.com");
		});

		it("lowercases the local part", () => {
			expect(canonicalizeEmail("JohnDoe@gmail.com")).toBe("johndoe@gmail.com");
		});

		it("strips a single trailing root-label dot from the domain", () => {
			expect(canonicalizeEmail("johndoe@gmail.com.")).toBe("johndoe@gmail.com");
		});

		it("trims surrounding whitespace", () => {
			expect(canonicalizeEmail("  John.Doe@gmail.com  ")).toBe("johndoe@gmail.com");
		});

		it("collapses the same plus alias that normalizeEmail preserves", () => {
			expect(canonicalizeEmail("jessika012023+whatever@gmail.com")).toBe("jessika012023@gmail.com");
		});
	});

	describe("never merges addresses that may belong to different people", () => {
		it("keeps dots significant on non-Gmail domains", () => {
			expect(canonicalizeEmail("first.last@fastmail.com")).toBe("first.last@fastmail.com");
			expect(canonicalizeEmail("firstlast@fastmail.com")).toBe("firstlast@fastmail.com");
		});

		it("leaves Google Workspace / custom domains untouched, where dots are significant", () => {
			expect(canonicalizeEmail("j.smith@acme.com")).toBe("j.smith@acme.com");
		});

		it("guards the Gmail domain with an exact match, not a suffix", () => {
			expect(canonicalizeEmail("a.b@notgmail.com")).toBe("a.b@notgmail.com");
			expect(canonicalizeEmail("a.b@gmail.com.evil.com")).toBe("a.b@gmail.com.evil.com");
		});

		it("lowercases only the domain off-Gmail, preserving the local part verbatim", () => {
			expect(canonicalizeEmail("First.Last@FastMail.com")).toBe("First.Last@fastmail.com");
		});

		it("leaves quoted Gmail local parts untouched", () => {
			expect(canonicalizeEmail('"john.doe"@gmail.com')).toBe('"john.doe"@gmail.com');
		});

		it("leaves a quoted Gmail local part containing + untouched", () => {
			expect(canonicalizeEmail('"john+doe"@gmail.com')).toBe('"john+doe"@gmail.com');
		});

		it("leaves non-ASCII Gmail local parts untouched", () => {
			expect(canonicalizeEmail("jöhn.doe@gmail.com")).toBe("jöhn.doe@gmail.com");
		});

		it("still folds googlemail.com to gmail.com when the local part is left untouched", () => {
			expect(canonicalizeEmail('"john.doe"@googlemail.com')).toBe('"john.doe"@gmail.com');
		});
	});

	describe("rejects malformed input that cannot be an identity", () => {
		it("throws when there is no domain", () => {
			expect(() => canonicalizeEmail("john@")).toThrow();
		});

		it("throws when there is no local part", () => {
			expect(() => canonicalizeEmail("@gmail.com")).toThrow();
		});

		it("throws when there is no @ at all", () => {
			expect(() => canonicalizeEmail("notanemail")).toThrow();
		});

		it("throws when a Gmail address is only a +tag", () => {
			expect(() => canonicalizeEmail("+tag@gmail.com")).toThrow();
		});

		it("throws when a Gmail local part is only dots", () => {
			expect(() => canonicalizeEmail("...@gmail.com")).toThrow();
		});
	});

	it("returns a branded CanonicalEmail", () => {
		const key: CanonicalEmail = canonicalizeEmail("john.doe@gmail.com");
		expect(key).toBe("johndoe@gmail.com");
	});
});
