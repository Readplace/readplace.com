import type { EffectiveAccess } from "@packages/subscription-access";

export const GMAIL_UPGRADE_MESSAGE = "Gmail integration is only available with an active paid subscription.";

export function canConnectGmail(access: EffectiveAccess): boolean {
	return access.tier === "founding" || access.tier === "paid";
}
