import assert from "node:assert/strict";
import { parseStripeWebhookSecret } from "./stripe-webhook-secret";

const VALID = "whsec_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";

describe("parseStripeWebhookSecret", () => {
	it("accepts a well-formed secret and returns it unchanged", () => {
		assert.equal(parseStripeWebhookSecret(VALID), VALID);
	});

	it("rejects a stray leading character, as pasted in the 2026-05-24 staging incident", () => {
		assert.throws(() => parseStripeWebhookSecret(`r${VALID}`), /STRIPE_WEBHOOK_SECRET/);
	});

	it("rejects a trailing extra character", () => {
		assert.throws(() => parseStripeWebhookSecret(`${VALID}x`), /STRIPE_WEBHOOK_SECRET/);
	});

	it("rejects a secret embedded in surrounding text", () => {
		assert.throws(() => parseStripeWebhookSecret(`pre-${VALID}-post`), /STRIPE_WEBHOOK_SECRET/);
	});

	it("rejects an empty string", () => {
		assert.throws(() => parseStripeWebhookSecret(""), /STRIPE_WEBHOOK_SECRET/);
	});

	it("rejects a truncated secret", () => {
		assert.throws(() => parseStripeWebhookSecret(`whsec_${"a".repeat(31)}`), /STRIPE_WEBHOOK_SECRET/);
	});

	it("rejects a charset outside alphanumerics", () => {
		assert.throws(() => parseStripeWebhookSecret(`whsec_${"a".repeat(31)}-`), /STRIPE_WEBHOOK_SECRET/);
	});

	it("rejects a trailing newline", () => {
		assert.throws(() => parseStripeWebhookSecret(`${VALID}\n`), /STRIPE_WEBHOOK_SECRET/);
	});

	it("reports the variable name and the length without the value", () => {
		assert.throws(() => parseStripeWebhookSecret(`r${VALID}`), {
			message:
				'Environment variable STRIPE_WEBHOOK_SECRET must match /^whsec_[A-Za-z0-9]{32}$/ — "whsec_" followed by 32 alphanumerics, 38 characters total; got 39 characters (value not shown)',
		});
	});
});
