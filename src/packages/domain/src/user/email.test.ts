import { normalizeEmail } from "./email";

describe("normalizeEmail (delivery address)", () => {
	it("lowercases the email", () => {
		expect(normalizeEmail("Test@Example.COM")).toBe("test@example.com");
	});

	it("trims whitespace", () => {
		expect(normalizeEmail("  test@example.com  ")).toBe("test@example.com");
	});

	it("preserves plus aliases, which some providers deliver to distinct mailboxes", () => {
		expect(normalizeEmail("jessika012023+whatever@gmail.com")).toBe("jessika012023+whatever@gmail.com");
	});

	it("preserves dots in the local part", () => {
		expect(normalizeEmail("john.doe@gmail.com")).toBe("john.doe@gmail.com");
	});
});
