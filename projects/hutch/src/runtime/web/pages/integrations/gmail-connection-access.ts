import type { EffectiveAccess } from "@packages/subscription-access";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchIntegrations } from "@packages/translations/hutch-integrations";

const { t } = translator(hutchIntegrations, DEFAULT_LOCALE);

export const GMAIL_UPGRADE_MESSAGE = "Gmail integration is only available with an active paid subscription.";

export function canConnectGmail(access: EffectiveAccess): boolean {
	return access.tier === "founding" || access.tier === "paid";
}

export const GMAIL_MODIFY_RECONNECT = {
	message: t("connectors.gmailModifyReconnect.message"),
	label: t("connectors.gmailModifyReconnect.action"),
};
