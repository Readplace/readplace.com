import { z } from "zod";
import type { GmailSenderEntry } from "./gmail-sender.types";

export const GmailDeliveryModeSchema = z.enum(["links", "issue", "both"]);
export type GmailDeliveryMode = z.infer<typeof GmailDeliveryModeSchema>;

export const NEW_MAPPING_DELIVERY_MODE: GmailDeliveryMode = "issue";

export const LEGACY_DELIVERY_MODE: GmailDeliveryMode = "links";

export interface GmailDeliveryFanOut {
	links: boolean;
	issue: boolean;
}

export const GMAIL_DELIVERY_FAN_OUT = {
	links: { links: true, issue: false },
	issue: { links: false, issue: true },
	both: { links: true, issue: true },
} satisfies Record<GmailDeliveryMode, GmailDeliveryFanOut>;

export function resolveGmailDeliveryMode(sender: Pick<GmailSenderEntry, "deliveryMode">): GmailDeliveryMode {
	return sender.deliveryMode ?? LEGACY_DELIVERY_MODE;
}

export function pickerDeliveryMode(
	existing: Pick<GmailSenderEntry, "deliveryMode" | "mappedAddresses"> | undefined,
): GmailDeliveryMode {
	if (existing?.mappedAddresses === undefined) return NEW_MAPPING_DELIVERY_MODE;
	return resolveGmailDeliveryMode(existing);
}
