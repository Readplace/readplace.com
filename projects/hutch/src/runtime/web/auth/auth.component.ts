import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageBody } from "../page-body.types";
import { render } from "../render";
import { renderFoundingProgress } from "../shared/founding-progress/founding-progress.component";
import { isFoundingAllocationExhausted } from "../shared/founding-progress/founding-allocation";
import { STRIPE_TRIAL_PERIOD_DAYS } from "../../providers/stripe-checkout/stripe-trial-config";
import { AUTH_STYLES } from "./auth.styles";

const LOGIN_TEMPLATE = readFileSync(join(__dirname, "login.template.html"), "utf-8");
const SIGNUP_TEMPLATE = readFileSync(join(__dirname, "signup.template.html"), "utf-8");
const VERIFY_EMAIL_TEMPLATE = readFileSync(join(__dirname, "verify-email.template.html"), "utf-8");
const FORGOT_PASSWORD_TEMPLATE = readFileSync(join(__dirname, "forgot-password.template.html"), "utf-8");
const RESET_PASSWORD_TEMPLATE = readFileSync(join(__dirname, "reset-password.template.html"), "utf-8");

interface FieldError {
	field: string;
	message: string;
}

interface AuthFormData {
	email?: string;
	errors?: FieldError[];
	globalError?: string;
	returnUrl?: string;
	userCount: number;
}

interface SignupFormData extends AuthFormData {
	loadedAt: number;
}

interface FieldViewModel {
	errorClass: string;
	error?: string;
}

function toFieldViewModel(
	errors: FieldError[] | undefined,
	field: string,
): FieldViewModel {
	const error = errors?.find((e) => e.field === field);
	return {
		errorClass: error ? " auth-form__input--error" : "",
		error: error?.message,
	};
}

export function LoginPage(data: AuthFormData, options?: { statusCode?: number }): PageBody {
	const email = data.email ?? "";
	const errors = data.errors;

	const content = render(LOGIN_TEMPLATE, {
		email,
		globalError: data.globalError,
		returnUrl: data.returnUrl ? encodeURIComponent(data.returnUrl) : undefined,
		emailField: toFieldViewModel(errors, "email"),
		passwordField: toFieldViewModel(errors, "password")
	});

	return {
		seo: {
			title: "Sign in — Readplace",
			description: "Sign in to your Readplace read-it-later account.",
			canonicalUrl: "/login",
		},
		styles: AUTH_STYLES,
		bodyClass: "page-login",
		content,
		statusCode: options?.statusCode,
	};
}

export function VerifyEmailPage(data: { success: boolean; error?: string }): PageBody {
	const content = render(VERIFY_EMAIL_TEMPLATE, data);

	return {
		seo: {
			title: "Verify email — Readplace",
			description: "Email verification for your Readplace account.",
			canonicalUrl: "/verify-email",
			robots: "noindex, nofollow",
		},
		styles: AUTH_STYLES,
		bodyClass: "page-verify-email",
		content,
		statusCode: data.success ? 200 : 400,
	};
}

export function SignupPage(data: SignupFormData, options?: { statusCode?: number }): PageBody {
	const email = data.email ?? "";
	const errors = data.errors;
	const trialSuffix = isFoundingAllocationExhausted(data.userCount)
		? ` (${STRIPE_TRIAL_PERIOD_DAYS} days free)`
		: "";

	const content = render(SIGNUP_TEMPLATE, {
		email,
		globalError: data.globalError,
		returnUrl: data.returnUrl ? encodeURIComponent(data.returnUrl) : undefined,
		loadedAt: data.loadedAt,
		emailField: toFieldViewModel(errors, "email"),
		passwordField: toFieldViewModel(errors, "password"),
		confirmPasswordField: toFieldViewModel(errors, "confirmPassword"),
		submitLabel: `Join Readplace${trialSuffix}`,
		googleLabel: `Sign up with Google${trialSuffix}`,
		foundingProgressHtml: renderFoundingProgress({
			userCount: data.userCount,
		}),
	});

	return {
		seo: {
			title: "Sign up — Readplace",
			description:
				"Create a Readplace account and start saving articles to read later.",
			canonicalUrl: "/signup",
		},
		styles: AUTH_STYLES,
		bodyClass: "page-signup",
		content,
		statusCode: options?.statusCode,
	};
}

export function ForgotPasswordPage(
	data?: { email?: string; errors?: FieldError[]; globalError?: string; sent?: boolean },
	options?: { statusCode?: number },
): PageBody {
	const email = data?.email ?? "";
	const errors = data?.errors;

	const content = render(FORGOT_PASSWORD_TEMPLATE, {
		email,
		globalError: data?.globalError,
		sent: data?.sent,
		emailField: toFieldViewModel(errors, "email"),
	});

	return {
		seo: {
			title: "Forgot password — Readplace",
			description: "Reset your Readplace account password.",
			canonicalUrl: "/forgot-password",
			robots: "noindex, nofollow",
		},
		styles: AUTH_STYLES,
		bodyClass: "page-forgot-password",
		content,
		statusCode: options?.statusCode,
	};
}

export function ResetPasswordPage(
	data: { token?: string; errors?: FieldError[]; globalError?: string; success?: boolean; error?: string },
	options?: { statusCode?: number },
): PageBody {
	const errors = data.errors;

	const content = render(RESET_PASSWORD_TEMPLATE, {
		token: data.token,
		globalError: data.globalError,
		success: data.success,
		error: data.error,
		passwordField: toFieldViewModel(errors, "password"),
		confirmPasswordField: toFieldViewModel(errors, "confirmPassword"),
	});

	return {
		seo: {
			title: "Reset password — Readplace",
			description: "Set a new password for your Readplace account.",
			canonicalUrl: "/reset-password",
			robots: "noindex, nofollow",
		},
		styles: AUTH_STYLES,
		bodyClass: "page-reset-password",
		content,
		statusCode: options?.statusCode,
	};
}
