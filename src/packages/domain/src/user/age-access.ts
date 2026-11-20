import { z } from "zod";

export const AGE_RANGES = ["under-13", "13-15", "16-17", "18-plus"] as const;
export const AgeRangeSchema = z.enum(AGE_RANGES);
export type AgeRange = z.infer<typeof AgeRangeSchema>;

export const PARENTAL_APPROVALS = ["none-reported", "approved", "pending", "denied", "revoked"] as const;
export const ParentalApprovalSchema = z.enum(PARENTAL_APPROVALS);
export type ParentalApproval = z.infer<typeof ParentalApprovalSchema>;

export type AgeAccessDecision = "allowed" | "refused:under-13" | "refused:parental-approval-missing";

export const AGE_LOCK_DELETION_DELAY_MS = 30 * 24 * 60 * 60 * 1000;

const APPROVAL_WITHHELD: ReadonlySet<ParentalApproval> = new Set(["pending", "denied", "revoked"]);

export function decideAgeAccess(signal: { ageRange: AgeRange; parentalApproval: ParentalApproval }): AgeAccessDecision {
	if (signal.ageRange === "under-13") return "refused:under-13";
	if (APPROVAL_WITHHELD.has(signal.parentalApproval)) return "refused:parental-approval-missing";
	return "allowed";
}
