import { createHmac } from "node:crypto";

/** Mirrors the `t=<unix_ts>,v1=<hex_hmac_sha256>` header format Stripe sends
 * so tests can construct valid headers without pulling in the Stripe SDK. */
export function signStripeWebhookHeader(params: {
	rawBody: Buffer;
	secret: string;
	timestampSeconds: number;
}): string {
	const payload = `${params.timestampSeconds}.${params.rawBody.toString("utf-8")}`;
	const signature = createHmac("sha256", params.secret).update(payload).digest("hex");
	return `t=${params.timestampSeconds},v1=${signature}`;
}
