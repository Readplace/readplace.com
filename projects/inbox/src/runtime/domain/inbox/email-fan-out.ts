import { GMAIL_DELIVERY_FAN_OUT, type GmailDeliveryFanOut } from "@packages/domain/gmail";
import type { EmailReceivedDetail } from "@packages/hutch-infra-components";

const INBOX_ADDRESS_FAN_OUT: GmailDeliveryFanOut = { links: true, issue: false };

export function resolveEmailFanOut(routing: EmailReceivedDetail["routing"]): GmailDeliveryFanOut {
	return routing.kind === "gmail" ? GMAIL_DELIVERY_FAN_OUT[routing.deliveryMode] : INBOX_ADDRESS_FAN_OUT;
}
