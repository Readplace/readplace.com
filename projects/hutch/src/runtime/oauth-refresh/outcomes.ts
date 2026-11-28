import { z } from "zod";
import { OAuthGrantIdSchema } from "@packages/domain/oauth";
import { RefreshAttempt, Revocation } from "./evidence";

export const RefreshRefusal = RefreshAttempt.extend({
	status: z.number().int(),
	reason: z.string(),
	grantId: OAuthGrantIdSchema.optional(),
	credentialExpiresAt: z.number().optional(),
	revocation: Revocation.optional(),
});
export type RefreshRefusal = z.infer<typeof RefreshRefusal>;
export const RefreshOutcome = z.object({
	day: z.string(),
	order: z.string(),
	expiresAt: z.number(),
	refusal: RefreshRefusal.optional(),
	recoveredAt: z.number().optional(),
});
export type RefreshOutcome = z.infer<typeof RefreshOutcome>;
