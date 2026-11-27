
import type { EmailDeliveryMode } from "@packages/domain/inbox";
import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchIntegrations } from "@packages/translations/hutch-integrations";

const { t } = translator(hutchIntegrations, DEFAULT_LOCALE);

export const GMAIL_DELIVERY_COPY: Record<EmailDeliveryMode, { option: string; description: string; row: string }> = {
	issue: {
		option: "The issue itself",
		description: t("gmailDelivery.issue"),
		row: "Saves each issue",
	},
	links: {
		option: "The articles it links to",
		description: t("gmailDelivery.links"),
		row: "Saves the linked articles",
	},
	both: {
		option: "Both",
		description: t("gmailDelivery.both"),
		row: "Saves each issue and its linked articles",
	},
};
