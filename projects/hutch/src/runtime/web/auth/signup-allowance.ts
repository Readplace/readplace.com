import type { Request } from "express";
import type { RateLimitDecision, RateLimitRule } from "@packages/domain/rate-limit";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchAuth } from "@packages/translations/hutch-auth";
import { rateLimitKeyFromRequest } from "../middleware/rate-limit";

const { tPlural } = translator(hutchAuth, DEFAULT_LOCALE);

export type ClaimSignupAllowance = (req: Request) => Promise<RateLimitDecision>;

export function initClaimSignupAllowance(deps: {
	consumeRateLimit: ConsumeRateLimit;
	rule: RateLimitRule;
}): ClaimSignupAllowance {
	return (req) =>
		deps.consumeRateLimit({
			bucket: "signup-created",
			key: rateLimitKeyFromRequest(req),
			rule: deps.rule,
		});
}

export function signupAllowanceSpentMessage(params: { limit: number }): string {
	return tPlural("signup.allowanceSpent", { count: params.limit });
}
