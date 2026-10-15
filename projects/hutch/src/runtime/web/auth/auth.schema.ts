import { z } from "zod";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmailDomain } from "./disposable-email";

const signupEmail = z
	.email({ message: "Enter a valid email address" })
	.refine((email) => !isDisposableEmailDomain(email), {
		message: DISPOSABLE_EMAIL_MESSAGE,
	});

export const LoginSchema = z.object({
	email: z.email({ message: "Enter a valid email address" }),
	password: z.string().min(1, "Password is required"),
});

export const SignupSchema = z.object({
	email: signupEmail,
	password: z.string().min(8, "Password must be at least 8 characters"),
});

export const ForgotPasswordSchema = z.object({
	email: z.email({ message: "Enter a valid email address" }),
});

export const CURRENT_PASSWORD_MISSING_MESSAGE = "Enter your current password";
export const PASSWORD_TOO_SHORT_MESSAGE = "Password must be at least 8 characters";
export const CONFIRM_PASSWORD_MISSING_MESSAGE = "Confirm your password";
export const PASSWORDS_MISMATCH_MESSAGE = "Passwords do not match";

const newPasswordFields = {
	password: z.string().min(8, PASSWORD_TOO_SHORT_MESSAGE),
	confirmPassword: z.string().min(1, CONFIRM_PASSWORD_MISSING_MESSAGE),
};

const passwordsMatch = (data: { password: string; confirmPassword: string }) =>
	data.password === data.confirmPassword;

const mismatchOnConfirm = { message: PASSWORDS_MISMATCH_MESSAGE, path: ["confirmPassword"] };

export const ResetPasswordSchema = z.object(newPasswordFields).refine(passwordsMatch, mismatchOnConfirm);

export const ChangePasswordSchema = z
	.object({ currentPassword: z.string().min(1, CURRENT_PASSWORD_MISSING_MESSAGE), ...newPasswordFields })
	.refine(passwordsMatch, mismatchOnConfirm);
