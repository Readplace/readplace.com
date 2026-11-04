import {
	EMAIL_DELIVERY_FAN_OUT,
	type EmailDeliveryFanOut,
	LEGACY_DELIVERY_MODE,
} from "@packages/domain/inbox";
import type { EmailReceivedDetail } from "@packages/infra-components";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";

export function resolveEmailFanOut({
	routing,
	inboxReadlist,
}: {
	routing: EmailReceivedDetail["routing"];
	inboxReadlist: Pick<ReadlistDefinitionData, "emailDelivery"> | undefined;
}): EmailDeliveryFanOut {
	return routing.kind === "gmail"
		? EMAIL_DELIVERY_FAN_OUT[routing.deliveryMode]
		: EMAIL_DELIVERY_FAN_OUT[inboxReadlist?.emailDelivery ?? LEGACY_DELIVERY_MODE];
}
