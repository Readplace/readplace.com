import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { type EffectiveAccess, resolveEffectiveAccess } from "./effective-access";

export type PlanAccess = "paid" | "trial" | "free";

export function resolvePlanAccess(row: SubscriptionRecord | undefined, now: Date): PlanAccess {
	const access = resolveEffectiveAccess(row, now);
	switch (access.tier) {
		case "founding":
		case "paid":
			return "paid";
		case "trial":
			return "trial";
		case "free":
			return "free";
	}
}

export function hasPaidFeatures(access: EffectiveAccess): boolean {
	switch (access.tier) {
		case "founding":
		case "paid":
		case "trial":
			return true;
		case "free":
			return false;
	}
}
