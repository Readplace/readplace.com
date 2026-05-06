import { buildSignupResumeUrl } from "./signup-resume-url";

describe("buildSignupResumeUrl", () => {
	it("encodes the email and appends utm_source=recovery", () => {
		const url = buildSignupResumeUrl({
			origin: "https://readplace.com",
			email: "jane@example.com",
		});

		expect(url).toBe(
			"https://readplace.com/signup?email=jane%40example.com&utm_source=recovery",
		);
	});

	it("encodes special characters in the email", () => {
		const url = buildSignupResumeUrl({
			origin: "https://readplace.com",
			email: "user+tag@example.com",
		});

		expect(url).toBe(
			"https://readplace.com/signup?email=user%2Btag%40example.com&utm_source=recovery",
		);
	});
});
