import assert from "node:assert";
import { z } from "zod";

const StripePriceIdSchema = z.string().regex(/^price_[A-Za-z0-9]{10,}$/);

export function parseStripePriceId(input: { name: string; value: string }): string {
	const result = StripePriceIdSchema.safeParse(input.value);
	assert(
		result.success,
		`Environment variable ${input.name} must be a Stripe price id — "price_" followed by at least 10 alphanumerics; got ${input.value.length} characters (value not shown)`,
	);
	return input.value;
}
