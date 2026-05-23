import assert from "node:assert/strict";
import { verifyStripeSignature, signStripeWebhookHeader } from "./verify-stripe-signature";

const SECRET = "whsec_test_verify";

function validBody(): { raw: Buffer; json: string } {
	const json = JSON.stringify({
		type: "customer.subscription.deleted",
		data: { object: { id: "sub_1" } },
	});
	return { raw: Buffer.from(json), json };
}

function sign(rawBody: Buffer, opts?: { secret?: string; timestampSeconds?: number }): string {
	return signStripeWebhookHeader({
		rawBody,
		secret: opts?.secret ?? SECRET,
		timestampSeconds: opts?.timestampSeconds ?? Math.floor(Date.now() / 1000),
	});
}

describe("verifyStripeSignature", () => {
	it("returns ok for a valid signature", () => {
		const { raw } = validBody();
		const now = Math.floor(Date.now() / 1000);
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: sign(raw, { timestampSeconds: now }),
			secret: SECRET,
			nowSeconds: now,
		});
		assert.equal(result.ok, true);
	});

	it("rejects a malformed header with no equals sign", () => {
		const { raw } = validBody();
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: "garbage",
			secret: SECRET,
			nowSeconds: Math.floor(Date.now() / 1000),
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "malformed-signature-header");
	});

	it("rejects a header with timestamp but no v1 signature", () => {
		const result = verifyStripeSignature({
			rawBody: validBody().raw,
			signatureHeader: "t=12345",
			secret: SECRET,
			nowSeconds: 12345,
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "malformed-signature-header");
	});

	it("rejects a header with v1 but no timestamp", () => {
		const result = verifyStripeSignature({
			rawBody: validBody().raw,
			signatureHeader: "v1=abc123",
			secret: SECRET,
			nowSeconds: Math.floor(Date.now() / 1000),
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "malformed-signature-header");
	});

	it("rejects a non-numeric timestamp", () => {
		const { raw } = validBody();
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: "t=notanumber,v1=abc123",
			secret: SECRET,
			nowSeconds: Math.floor(Date.now() / 1000),
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "non-numeric-timestamp");
	});

	it("rejects a timestamp outside tolerance", () => {
		const { raw } = validBody();
		const old = Math.floor(Date.now() / 1000) - 600;
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: sign(raw, { timestampSeconds: old }),
			secret: SECRET,
			nowSeconds: Math.floor(Date.now() / 1000),
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "timestamp-out-of-tolerance");
	});

	it("rejects a signature with wrong length", () => {
		const { raw } = validBody();
		const now = Math.floor(Date.now() / 1000);
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: `t=${now},v1=short`,
			secret: SECRET,
			nowSeconds: now,
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "signature-mismatch");
	});

	it("rejects a correct-length signature that does not match", () => {
		const { raw } = validBody();
		const now = Math.floor(Date.now() / 1000);
		const fakeHex = "a".repeat(64);
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: `t=${now},v1=${fakeHex}`,
			secret: SECRET,
			nowSeconds: now,
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "signature-mismatch");
	});

	it("rejects a valid signature wrapping non-JSON body", () => {
		const raw = Buffer.from("not json");
		const now = Math.floor(Date.now() / 1000);
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: sign(raw, { timestampSeconds: now }),
			secret: SECRET,
			nowSeconds: now,
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "invalid-json");
	});

	it("rejects valid JSON that doesn't match the Stripe event schema", () => {
		const raw = Buffer.from(JSON.stringify({ unexpected: true }));
		const now = Math.floor(Date.now() / 1000);
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: sign(raw, { timestampSeconds: now }),
			secret: SECRET,
			nowSeconds: now,
		});
		assert.equal(result.ok, false);
		assert(result.ok === false);
		assert.equal(result.reason, "invalid-event-shape");
	});

	it("accepts when one of multiple v1 signatures matches", () => {
		const { raw } = validBody();
		const now = Math.floor(Date.now() / 1000);
		const validSig = sign(raw, { timestampSeconds: now }).split(",v1=")[1];
		const header = `t=${now},v1=${"b".repeat(64)},v1=${validSig}`;
		const result = verifyStripeSignature({
			rawBody: raw,
			signatureHeader: header,
			secret: SECRET,
			nowSeconds: now,
		});
		assert.equal(result.ok, true);
	});
});

describe("signStripeWebhookHeader", () => {
	it("produces a header verifyStripeSignature accepts", () => {
		const raw = Buffer.from(JSON.stringify({ type: "test", data: { object: { id: "x" } } }));
		const ts = Math.floor(Date.now() / 1000);
		const header = signStripeWebhookHeader({ rawBody: raw, secret: SECRET, timestampSeconds: ts });
		const result = verifyStripeSignature({ rawBody: raw, signatureHeader: header, secret: SECRET, nowSeconds: ts });
		assert.equal(result.ok, true);
	});
});
