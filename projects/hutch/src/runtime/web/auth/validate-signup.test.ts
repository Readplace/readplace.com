import type { FindUserByEmail } from "@packages/test-fixtures/providers/auth";
import { UserIdSchema } from "@packages/domain/user";
import { initValidateSignup, SIGNUP_MIN_SUBMIT_MS } from "./validate-signup";

const NOW_MS = 1_700_000_000_000;
const FRESH_LOADED_AT = String(NOW_MS - SIGNUP_MIN_SUBMIT_MS);

const validBody = {
	email: "new@example.com",
	password: "password123",
	confirmPassword: "password123",
	loadedAt: FRESH_LOADED_AT,
};

const noUser: FindUserByEmail = async () => null;
const existingUser: FindUserByEmail = async () => ({
	userId: UserIdSchema.parse("user_existing"),
	emailVerified: true,
});

describe("initValidateSignup", () => {
	describe("bot defense", () => {
		it("rejects with reason 'honeypot' when the website field is filled", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, website: "https://spam" },
				nowMs: NOW_MS,
			});

			expect(result).toEqual({ ok: false, kind: "bot-rejected", reason: "honeypot" });
		});

		it("rejects with reason 'missing_timestamp' when loadedAt is absent", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });
			const { loadedAt: _omit, ...bodyWithoutLoadedAt } = validBody;

			const result = await validateSignup({
				body: bodyWithoutLoadedAt,
				nowMs: NOW_MS,
			});

			expect(result).toEqual({ ok: false, kind: "bot-rejected", reason: "missing_timestamp" });
		});

		it("rejects with reason 'missing_timestamp' when loadedAt is an empty string", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, loadedAt: "" },
				nowMs: NOW_MS,
			});

			expect(result).toEqual({ ok: false, kind: "bot-rejected", reason: "missing_timestamp" });
		});

		it("rejects with reason 'invalid_timestamp' when loadedAt is non-numeric", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, loadedAt: "abc" },
				nowMs: NOW_MS,
			});

			expect(result).toEqual({ ok: false, kind: "bot-rejected", reason: "invalid_timestamp" });
		});

		it("rejects with reason 'invalid_timestamp' when loadedAt has trailing garbage", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, loadedAt: "1700000000000abc" },
				nowMs: NOW_MS,
			});

			expect(result).toEqual({ ok: false, kind: "bot-rejected", reason: "invalid_timestamp" });
		});

		it("rejects with reason 'submit_too_fast' and the elapsed ms when the form was submitted too quickly", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });
			const loadedAt = NOW_MS - 1000;

			const result = await validateSignup({
				body: { ...validBody, loadedAt: String(loadedAt) },
				nowMs: NOW_MS,
			});

			expect(result).toEqual({
				ok: false,
				kind: "bot-rejected",
				reason: "submit_too_fast",
				timeToSubmitMs: 1000,
			});
		});
	});

	describe("schema errors", () => {
		it("returns a field-errors result with a fieldName='email' entry when the email is invalid", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, email: "not-an-email" },
				nowMs: NOW_MS,
			});

			expect(result.ok).toBe(false);
			if (result.ok || result.kind !== "field-errors") throw new Error("expected field-errors");
			expect(result.errors).toContainEqual({
				fieldName: "email",
				message: "Please enter a valid email address",
			});
			expect(result.email).toBe("not-an-email");
		});

		it("returns a field-errors result with a fieldName='password' entry when the password is shorter than 8 chars", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, password: "short", confirmPassword: "short" },
				nowMs: NOW_MS,
			});

			if (result.ok || result.kind !== "field-errors") throw new Error("expected field-errors");
			expect(result.errors).toContainEqual({
				fieldName: "password",
				message: "Password must be at least 8 characters",
			});
		});

		it("returns a field-errors result with a fieldName='confirmPassword' entry when the passwords do not match", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, confirmPassword: "different1" },
				nowMs: NOW_MS,
			});

			if (result.ok || result.kind !== "field-errors") throw new Error("expected field-errors");
			expect(result.errors).toContainEqual({
				fieldName: "confirmPassword",
				message: "Passwords do not match",
			});
		});

		it("captures email as undefined when it is missing from the body", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });
			const { email: _omit, ...bodyWithoutEmail } = validBody;

			const result = await validateSignup({
				body: bodyWithoutEmail,
				nowMs: NOW_MS,
			});

			if (result.ok || result.kind !== "field-errors") throw new Error("expected field-errors");
			expect(result.email).toBeUndefined();
		});

		it("captures email as undefined when it is not a string", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({
				body: { ...validBody, email: 123 },
				nowMs: NOW_MS,
			});

			if (result.ok || result.kind !== "field-errors") throw new Error("expected field-errors");
			expect(result.email).toBeUndefined();
		});
	});

	describe("duplicate email", () => {
		it("returns a duplicate-email result when findUserByEmail resolves to a user", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: existingUser });

			const result = await validateSignup({ body: validBody, nowMs: NOW_MS });

			expect(result).toEqual({
				ok: false,
				kind: "duplicate-email",
				email: "new@example.com",
			});
		});
	});

	describe("happy path", () => {
		it("returns the validated email and password when every gate passes", async () => {
			const validateSignup = initValidateSignup({ findUserByEmail: noUser });

			const result = await validateSignup({ body: validBody, nowMs: NOW_MS });

			expect(result).toEqual({
				ok: true,
				email: "new@example.com",
				password: "password123",
			});
		});
	});
});
