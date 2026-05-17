import type {
	BotDefenseRejectReason,
	FindUserByEmail,
} from "@packages/test-fixtures/providers/auth";
import type { ComponentError } from "../shared/component-error.types";
import { SignupSchema } from "./auth.schema";
import { flattenZodErrors } from "./flatten-zod-errors";

export const SIGNUP_MIN_SUBMIT_MS = 2500;

export type SignupValidationResult =
	| { ok: true; email: string; password: string }
	| {
			ok: false;
			kind: "bot-rejected";
			reason: BotDefenseRejectReason;
			timeToSubmitMs?: number;
	  }
	| {
			ok: false;
			kind: "field-errors";
			errors: ComponentError[];
			email: string | undefined;
	  }
	| { ok: false; kind: "duplicate-email"; email: string };

export interface ValidateSignupInput {
	body: Record<string, unknown>;
	nowMs: number;
}

type BotRejection = {
	reason: BotDefenseRejectReason;
	timeToSubmitMs?: number;
};

function checkBotDefense(
	body: Record<string, unknown>,
	nowMs: number,
): BotRejection | undefined {
	const website = body.website;
	if (typeof website === "string" && website.length > 0) {
		return { reason: "honeypot" };
	}

	const rawLoadedAt = body.loadedAt;
	if (typeof rawLoadedAt !== "string" || rawLoadedAt.length === 0) {
		return { reason: "missing_timestamp" };
	}

	const loadedAt = Number.parseInt(rawLoadedAt, 10);
	if (!Number.isFinite(loadedAt) || String(loadedAt) !== rawLoadedAt) {
		return { reason: "invalid_timestamp" };
	}

	const elapsed = nowMs - loadedAt;
	if (elapsed < SIGNUP_MIN_SUBMIT_MS) {
		return { reason: "submit_too_fast", timeToSubmitMs: elapsed };
	}

	return undefined;
}

export function initValidateSignup(deps: {
	findUserByEmail: FindUserByEmail;
}): (input: ValidateSignupInput) => Promise<SignupValidationResult> {
	return async ({ body, nowMs }) => {
		const bot = checkBotDefense(body, nowMs);
		if (bot) {
			return { ok: false, kind: "bot-rejected", ...bot };
		}

		const parsed = SignupSchema.safeParse(body);
		if (!parsed.success) {
			const submittedEmail =
				typeof body.email === "string" ? body.email : undefined;
			return {
				ok: false,
				kind: "field-errors",
				errors: flattenZodErrors(parsed.error.issues),
				email: submittedEmail,
			};
		}

		const { email, password } = parsed.data;
		const existing = await deps.findUserByEmail(email);
		if (existing) {
			return { ok: false, kind: "duplicate-email", email };
		}

		return { ok: true, email, password };
	};
}
