import { z } from "zod";

/** The event type Resend emits when a message arrives at an inbound domain. */
export const INBOUND_EMAIL_RECEIVED_TYPE = "email.received";

/** Validates the Resend inbound webhook envelope. The payload is metadata only
 * (sender, recipients, subject) — the body is retrieved separately by
 * `data.email_id`. Recipients arrive as a string or an array depending on
 * fan-out, so both shapes are accepted and normalized by `inboundRecipients`. */
export const InboundEmailWebhookSchema = z.object({
	type: z.string(),
	created_at: z.string(),
	data: z.object({
		email_id: z.string().min(1),
		from: z.string(),
		to: z.union([z.string(), z.array(z.string())]),
		subject: z.string().optional(),
	}),
});

export type InboundEmailWebhook = z.infer<typeof InboundEmailWebhookSchema>;

export function inboundRecipients(
	to: string | readonly string[],
): readonly string[] {
	return typeof to === "string" ? [to] : to;
}
