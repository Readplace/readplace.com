import { z } from "zod";
import { DISPOSABLE_EMAIL_MESSAGE, isDisposableEmailDomain } from "./disposable-email";

const signupEmail = z
	.email({ message: "Please enter a valid email address" })
	.refine((email) => !isDisposableEmailDomain(email), {
		message: DISPOSABLE_EMAIL_MESSAGE,
	});

export const LoginSchema = z.object({
	email: z.email({ message: "Please enter a valid email address" }),
	password: z.string().min(1, "Password is required"),
});

export const SignupSchema = z.object({
	email: signupEmail,
	password: z.string().min(8, "Password must be at least 8 characters"),
});

export const ForgotPasswordSchema = z.object({
	email: z.email({ message: "Please enter a valid email address" }),
});

export const ResetPasswordSchema = z
	.object({
		password: z.string().min(8, "Password must be at least 8 characters"),
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});
