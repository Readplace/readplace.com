import { z } from "zod";

export const LoginSchema = z.object({
	email: z.email({ message: "Please enter a valid email address" }),
	password: z.string().min(1, "Password is required"),
});

export const SignupSchema = z
	.object({
		email: z.email({ message: "Please enter a valid email address" }),
		password: z.string().min(8, "Password must be at least 8 characters"),
		confirmPassword: z.string().min(1, "Please confirm your password"),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
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
