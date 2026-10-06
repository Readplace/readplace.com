import type { GmailDeliveryMode } from "@packages/domain/gmail";

export const GMAIL_DELIVERY_COPY: Record<GmailDeliveryMode, { option: string; description: string; row: string }> = {
	issue: {
		option: "The issue itself",
		description: "Each issue lands in your readlist as one article. Save the links you want while you read it.",
		row: "Saves each issue",
	},
	links: {
		option: "The articles it links to",
		description: "The articles each issue links to are saved one by one. The email stays on its inbox page.",
		row: "Saves the linked articles",
	},
	both: {
		option: "Both",
		description: "Each issue lands as an article, and the articles it links to are saved beside it.",
		row: "Saves each issue and its linked articles",
	},
};
