import type { ForwardableSender } from "@packages/domain/gmail";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";

export type SubmitNewsletterSenders = (senders: readonly ForwardableSender[]) => Promise<void>;

export function initSubmitNewsletterSenders(
	deps: Pick<GmailIntegrationDependencies, "detectNewsletters" | "publishSubmitNewsletterSender">,
): SubmitNewsletterSenders {
	return async (senders) => {
		const detection = await deps.detectNewsletters(senders);
		for (const sender of senders) {
			if (detection.status === "unavailable" || detection.recognized.get(sender)?.match !== "exact") {
				await deps.publishSubmitNewsletterSender({ senderEmail: sender });
			}
		}
	};
}
