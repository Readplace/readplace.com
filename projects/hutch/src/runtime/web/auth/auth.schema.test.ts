import { LoginSchema, SignupSchema } from "./auth.schema";

describe("LoginSchema", () => {
	it("accepts valid email and password", () => {
		const result = LoginSchema.safeParse({ email: "user@example.com", password: "secret123" });

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
	it("accepts matching passwords of 8+ characters", () => {
		const result = SignupSchema.safeParse({
			email: "user@example.com",
			password: "longpassword",
			confirmPassword: "longpassword",
		});

		expect(result.success).toBe(true);
	});

	it("rejects passwords shorter than 8 characters", () => {
		const result = SignupSchema.safeParse({
			email: "user@example.com",
			password: "short",
			confirmPassword: "short",
		});

		expect(result.success).toBe(false);
	});

	it("rejects mismatched passwords", () => {
		const result = SignupSchema.safeParse({
			email: "user@example.com",
			password: "longpassword",
			confirmPassword: "different-password",
		});

		expect(result.success).toBe(false);
	});

	it("rejects an invalid email", () => {
		const result = SignupSchema.safeParse({
			email: "bad-email",
			password: "longpassword",
			confirmPassword: "longpassword",
		});

		expect(result.success).toBe(false);
	});

	it("rejects an empty confirmPassword", () => {
		const result = SignupSchema.safeParse({
			email: "user@example.com",
			password: "longpassword",
			confirmPassword: "",
		});

		expect(result.success).toBe(false);
	});
});
