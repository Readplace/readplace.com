import type { EffectiveAccess } from "@packages/subscription-access";

export const GMAIL_UPGRADE_MESSAGE = "Gmail integration is only available with an active paid subscription.";

export function canConnectGmail(access: EffectiveAccess): boolean {
	return access.tier === "founding" || access.tier === "paid";
}

export const GMAIL_MODIFY_RECONNECT_MESSAGE = "Newsletters still save to Readplace. Reconnect Gmail to let Readplace mark and label originals that are still unread after saving.";
