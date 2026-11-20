import { ageLockEmail } from "./age-lock-email";

describe("ageLockEmail", () => {
	const email = ageLockEmail({ unlockUrl: "https://readplace.com/account/age-unlock?token=abc" });

	it("says the account is paused in its subject", () => {
		expect(email.subject).toBe("your Readplace account is paused");
	});

	it("explains the report and the 30-day deletion, and links the unlock confirmation", () => {
		expect(email.html).toContain("reported that the person using your account is under 13");
		expect(email.html).toContain("Unless you confirm within 30 days");
		expect(email.html).toContain('href="https://readplace.com/account/age-unlock?token&#x3D;abc"');
		expect(email.html).toContain("This is my account and I am 13 or over");
	});
});
