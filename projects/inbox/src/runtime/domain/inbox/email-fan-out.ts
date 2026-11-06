import { EMAIL_DELIVERY_FAN_OUT, type EmailDeliveryFanOut } from "@packages/domain/inbox";
import type { EmailReceivedDetail } from "@packages/infra-components";

export function resolveEmailFanOut({ routing }: { routing: EmailReceivedDetail["routing"] }): EmailDeliveryFanOut {
	return routing.kind === "gmail" ? EMAIL_DELIVERY_FAN_OUT[routing.deliveryMode] : EMAIL_DELIVERY_FAN_OUT.links;
}
