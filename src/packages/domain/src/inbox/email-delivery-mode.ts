import { z } from "zod";

export const EmailDeliveryModeSchema = z.enum(["links", "issue", "both"]);
export type EmailDeliveryMode = z.infer<typeof EmailDeliveryModeSchema>;

export const LEGACY_DELIVERY_MODE: EmailDeliveryMode = "links";

export interface EmailDeliveryFanOut {
	links: boolean;
	issue: boolean;
}

export const EMAIL_DELIVERY_FAN_OUT = {
	links: { links: true, issue: false },
	issue: { links: false, issue: true },
	both: { links: true, issue: true },
} satisfies Record<EmailDeliveryMode, EmailDeliveryFanOut>;
