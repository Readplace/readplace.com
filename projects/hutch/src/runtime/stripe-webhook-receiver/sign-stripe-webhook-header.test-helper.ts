import { createHmac } from "node:crypto";

/** Builds a valid HMAC-signed webhook header so tests can construct one
 * without pulling in the payment provider's SDK. */
export function signStripeWebhookHeader(params: {
	rawBody: Buffer;
	secret: string;
	timestampSeconds: number;
}): string {
	const payload = `${params.timestampSeconds}.${params.rawBody.toString("utf-8")}`;
	const signature = createHmac("sha256", params.secret).update(payload).digest("hex");
	return `t=${params.timestampSeconds},v1=${signature}`;
}
