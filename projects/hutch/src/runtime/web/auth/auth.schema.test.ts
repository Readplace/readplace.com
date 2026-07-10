import { LoginSchema, SignupSchema } from "./auth.schema";
import { DISPOSABLE_EMAIL_MESSAGE } from "./disposable-email";

describe("LoginSchema", () => {
	it("accepts valid email and password", () => {
		const result = LoginSchema.safeParse({ email: "user@example.com", password: "secret123" });

		expect(result.success).toBe(true);
	});

	it("accepts a disposable email domain (the disposable rule is signup-only)", () => {
		const result = LoginSchema.safeParse({ email: "user@slmail.me", password: "secret123" });

		expect(result.success).toBe(true);
	});

	it("rejects an invalid email", () => {
		const result = LoginSchema.safeParse({ email: "not-an-email", password: "secret123" });

		expect(result.success).toBe(false);
	});

	it("rejects an empty password", () => {
		const result = LoginSchema.safeParse({ email: "user@example.com", password: "" });

		expect(result.success).toBe(false);
	});
});

describe("SignupSchema", () => {
	it("accepts a valid email with a password of 8+ characters", () => {
		const result = SignupSchema.safeParse({
			email: "user@example.com",
			password: "longpassword",
		});

		expect(result.success).toBe(true);
	});

	it("rejects passwords shorter than 8 characters", () => {
		const result = SignupSchema.safeParse({
			email: "user@example.com",
			password: "short",
		});

		expect(result.success).toBe(false);
	});

	it("rejects an invalid email", () => {
		const result = SignupSchema.safeParse({
			email: "bad-email",
			password: "longpassword",
		});

		expect(result.success).toBe(false);
	});

	it("rejects a disposable email domain with the disposable message", () => {
		const result = SignupSchema.safeParse({
			email: "user@slmail.me",
			password: "longpassword",
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		const emailIssue = result.error.issues.find((issue) => issue.path.includes("email"));
		expect(emailIssue?.message).toBe(DISPOSABLE_EMAIL_MESSAGE);
	});
});
