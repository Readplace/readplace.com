import { ChangePasswordSchema, LoginSchema, SignupSchema } from "./auth.schema";
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

describe("ChangePasswordSchema", () => {
	it("accepts the current password with a new password confirmed", () => {
		const result = ChangePasswordSchema.safeParse({
			currentPassword: "old-password",
			password: "a-new-password",
			confirmPassword: "a-new-password",
		});

		expect(result.success).toBe(true);
	});

	it("reports a confirmation that differs from the new password on the confirmation field", () => {
		const result = ChangePasswordSchema.safeParse({
			currentPassword: "old-password",
			password: "a-new-password",
			confirmPassword: "another-password",
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))).toEqual([
			{ path: ["confirmPassword"], message: "Passwords do not match" },
		]);
	});

	it("reports a missing current password on the current password field", () => {
		const result = ChangePasswordSchema.safeParse({
			currentPassword: "",
			password: "a-new-password",
			confirmPassword: "a-new-password",
		});

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }))).toEqual([
			{ path: ["currentPassword"], message: "Enter your current password" },
		]);
	});
});
