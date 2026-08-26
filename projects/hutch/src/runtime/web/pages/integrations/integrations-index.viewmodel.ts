import type { IconName } from "@packages/ui-icons";

export type IntegrationStatusKey = "not-set-up" | "coming-soon";

export interface IntegrationRowViewModel {
	key: string;
	name: string;
	description: string;
	iconName: IconName;
	statusKey: IntegrationStatusKey;
	statusLabel: string;
	statusModifier: string;
}

export interface IntegrationsIndexViewModel {
	services: IntegrationRowViewModel[];
}

const STATUS_LABELS: Record<IntegrationStatusKey, string> = {
	"not-set-up": "Not set up",
	"coming-soon": "Coming soon",
};

function statusRow(input: {
	key: string;
	name: string;
	description: string;
	iconName: IconName;
	statusKey: IntegrationStatusKey;
}): IntegrationRowViewModel {
	return {
		key: input.key,
		name: input.name,
		description: input.description,
		iconName: input.iconName,
		statusKey: input.statusKey,
		statusLabel: STATUS_LABELS[input.statusKey],
		statusModifier: `integrations__status--${input.statusKey}`,
	};
}

export function toIntegrationsIndexViewModel(): IntegrationsIndexViewModel {
	return {
		services: [
			statusRow({
				key: "gmail",
				name: "Gmail",
				description: "Forward newsletters from Gmail into your Readplace inboxes.",
				iconName: "mail",
				statusKey: "not-set-up",
			}),
			statusRow({
				key: "outlook",
				name: "Outlook",
				description: "Not available yet.",
				iconName: "mail",
				statusKey: "coming-soon",
			}),
		],
	};
}
