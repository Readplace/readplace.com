import { createHmac, timingSafeEqual } from "node:crypto";

export interface InboundSignatureHeaders {
	id: string | undefined;
	timestamp: string | undefined;
	signature: string | undefined;
}

export type VerifyInboundSignatureResult =
	| { ok: true }
	| { ok: false; reason: "missing-headers" | "stale-timestamp" | "no-match" };

/** Reject signatures whose timestamp is further than this from now, in either
 * direction, to bound replay of a captured request. */
const TOLERANCE_SECONDS = 5 * 60;

function constantTimeEquals(a: string, b: string): boolean {
	const aBuf = Buffer.from(a);
	const bBuf = Buffer.from(b);
	if (aBuf.length !== bBuf.length) return false;
	return timingSafeEqual(aBuf, bBuf);
}

/**
 * Verifies a Svix-format webhook signature (the scheme Resend uses for inbound
 * email events). The signed content is `${id}.${timestamp}.${payload}`, HMAC'd
 * with the base64-decoded secret (sans `whsec_` prefix); the `svix-signature`
 * header carries one or more space-separated `v<version>,<base64>` entries and
 * verification succeeds if any `v1` entry matches.
 */
export function verifyInboundSignature(input: {
	secret: string;
	payload: string;
	headers: InboundSignatureHeaders;
	now: Date;
}): VerifyInboundSignatureResult {
	const { id, timestamp, signature } = input.headers;
	if (id === undefined || timestamp === undefined || signature === undefined) {
		return { ok: false, reason: "missing-headers" };
	}

	const sentAt = Number.parseInt(timestamp, 10);
	const nowSeconds = Math.floor(input.now.getTime() / 1000);
	if (!Number.isFinite(sentAt) || Math.abs(nowSeconds - sentAt) > TOLERANCE_SECONDS) {
		return { ok: false, reason: "stale-timestamp" };
	}

	const secretBytes = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
	const signedContent = `${id}.${timestamp}.${input.payload}`;
	const expected = createHmac("sha256", secretBytes).update(signedContent).digest("base64");

	const matched = signature.split(" ").some((entry) => {
		const [version, value] = entry.split(",");
		return version === "v1" && value !== undefined && constantTimeEquals(value, expected);
	});

	return matched ? { ok: true } : { ok: false, reason: "no-match" };
}
