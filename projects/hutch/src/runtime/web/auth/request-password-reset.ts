import { FOUNDER_SENDER } from "../../email-senders";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import { canonicalizeEmail, normalizeEmail } from "@packages/domain/user";
import type { Logger, LogError } from "@packages/logger";
import type { UserExistsByEmail } from "@packages/provider-contracts/auth";
import type { SendEmail } from "@packages/provider-contracts/email";
import type { CreatePasswordResetToken } from "@packages/provider-contracts/password-reset";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { buildPasswordResetEmailHtml } from "./password-reset-email";


export type PasswordResetRefusedEvent = {
	event: "password_reset_refused";
	key: "ip" | "address";
	retryAfterSeconds: number;
};

function passwordResetAddressKey(email: string): string {
	const normalized = normalizeEmail(email);
	try {
		return canonicalizeEmail(normalized);
	} catch {
		return normalized;
	}
}

function toError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

export function initRequestPasswordReset(deps: {
	consumeRateLimit: ConsumeRateLimit;
	accountRule: RateLimitRule;
	userExistsByEmail: UserExistsByEmail;
	createPasswordResetToken: CreatePasswordResetToken;
	sendEmail: SendEmail;
	baseUrl: string;
	logger: Logger.Typed<PasswordResetRefusedEvent>;
	logError: LogError;
}): (params: { email: string }) => Promise<void> {
	return async ({ email }) => {
		const decision = await deps
			.consumeRateLimit({
				bucket: "forgot-password-account",
				key: passwordResetAddressKey(email),
				rule: deps.accountRule,
			})
			.catch((err: unknown) => {
				deps.logError("[RateLimit] Password reset address limit check failed", toError(err));
				return undefined;
			});
		if (decision === undefined) return;
		if (!decision.allowed) {
			deps.logger.info({
				event: "password_reset_refused",
				key: "address",
				retryAfterSeconds: decision.retryAfterSeconds,
			});
			return;
		}

		await deps.userExistsByEmail(email)
			.then(async (exists) => {
				if (!exists) return;
				const token = await deps.createPasswordResetToken({ email });
				const resetUrl = `${deps.baseUrl}/reset-password?token=${token}`;
				const html = buildPasswordResetEmailHtml(resetUrl);
				return deps.sendEmail({
					from: FOUNDER_SENDER,
					to: email,
					subject: "Reset your password — Readplace",
					html,
				});
			})
			.catch((err: unknown) => {
				deps.logError("[Email] Password reset email failed", toError(err));
			});
	};
}
