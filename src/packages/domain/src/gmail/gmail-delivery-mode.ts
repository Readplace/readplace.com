import {
	EMAIL_DELIVERY_FAN_OUT,
	type EmailDeliveryMode,
	EmailDeliveryModeSchema,
	LEGACY_DELIVERY_MODE,
} from "../mail-identity/email-delivery-mode";
import type { GmailMapping } from "./gmail-mapping.types";

export const GmailDeliveryModeSchema = EmailDeliveryModeSchema;
export type GmailDeliveryMode = EmailDeliveryMode;

export const NEW_MAPPING_DELIVERY_MODE: GmailDeliveryMode = "issue";

export { LEGACY_DELIVERY_MODE };

export const GMAIL_DELIVERY_FAN_OUT = EMAIL_DELIVERY_FAN_OUT;

export function resolveGmailDeliveryMode(sender: Pick<GmailMapping, "deliveryMode">): GmailDeliveryMode {
	return sender.deliveryMode ?? LEGACY_DELIVERY_MODE;
}

export function pickerDeliveryMode(
	existing: Pick<GmailMapping, "deliveryMode" | "mappedAddresses"> | undefined,
): GmailDeliveryMode {
	if (existing?.mappedAddresses === undefined) return NEW_MAPPING_DELIVERY_MODE;
	return resolveGmailDeliveryMode(existing);
}
