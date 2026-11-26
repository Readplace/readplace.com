import { z } from "zod";
import { OAuthGrantId, RefreshAttempt } from "./evidence";

export const RefreshRefusal = RefreshAttempt.extend({
	status: z.number().int(),
	reason: z.string(),
	grantId: OAuthGrantId.optional(),
	credentialExpiresAt: z.number().optional(),
	revocation: z.object({ cause: z.enum(["rotation", "logout", "logout-all", "account-deletion", "disconnect"]), completedAt: z.number() }).optional(),
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
