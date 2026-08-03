import assert from "node:assert";
import { z } from "zod";

const StripeWebhookSecretSchema = z.string().regex(/^whsec_[A-Za-z0-9]{32}$/);

export function parseStripeWebhookSecret(value: string): string {
	const result = StripeWebhookSecretSchema.safeParse(value);
	assert(
		result.success,
		`Environment variable STRIPE_WEBHOOK_SECRET must match /^whsec_[A-Za-z0-9]{32}$/ — "whsec_" followed by 32 alphanumerics, 38 characters total; got ${value.length} characters (value not shown)`,
	);
	return value;
}
