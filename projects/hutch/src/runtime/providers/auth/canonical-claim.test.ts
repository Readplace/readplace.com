import { canonicalizeEmail } from "@packages/domain/user";
import { gmailClaimPk, isClaimPk } from "./canonical-claim";

describe("gmailClaimPk", () => {
	it("prefixes the canonical key into the claim namespace", () => {
		expect(gmailClaimPk(canonicalizeEmail("john.doe@gmail.com"))).toBe("canonical#johndoe@gmail.com");
	});
});

describe("isClaimPk", () => {
	it("is true for a claim PK", () => {
		expect(isClaimPk("canonical#johndoe@gmail.com")).toBe(true);
	});

	it("is false for a delivery email", () => {
		expect(isClaimPk("john.doe@gmail.com")).toBe(false);
	});
});
