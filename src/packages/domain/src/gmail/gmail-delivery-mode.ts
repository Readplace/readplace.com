import { type EmailDeliveryMode, LEGACY_DELIVERY_MODE } from "../mail-identity/email-delivery-mode";
import type { GmailMapping } from "./gmail-mapping.types";

export const NEW_MAPPING_DELIVERY_MODE: EmailDeliveryMode = "issue";

export function resolveGmailDeliveryMode(sender: Pick<GmailMapping, "deliveryMode">): EmailDeliveryMode {
	return sender.deliveryMode ?? LEGACY_DELIVERY_MODE;
}

export function pickerDeliveryMode(
	existing: Pick<GmailMapping, "deliveryMode" | "mappedAddresses"> | undefined,
): EmailDeliveryMode {
	if (existing?.mappedAddresses === undefined) return NEW_MAPPING_DELIVERY_MODE;
	return resolveGmailDeliveryMode(existing);
}
