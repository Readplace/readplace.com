import { LEGACY_DELIVERY_MODE } from "@packages/domain/gmail";
import type { InboxEmailEntry } from "@packages/domain/inbox";
import type { EmailReceivedDetail } from "@packages/hutch-infra-components";

export function acceptedGmailRouting(
	email: Pick<InboxEmailEntry, "gmailDestinationAddresses" | "gmailDeliveryMode">,
): Extract<EmailReceivedDetail["routing"], { kind: "gmail" }> | undefined {
	if (email.gmailDestinationAddresses === undefined) return undefined;
	return {
		kind: "gmail",
		destinationAddresses: email.gmailDestinationAddresses,
		deliveryMode: email.gmailDeliveryMode ?? LEGACY_DELIVERY_MODE,
	};
}
