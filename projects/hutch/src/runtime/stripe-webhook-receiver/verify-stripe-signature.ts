import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const StripeEventSchema = z
	.object({
		type: z.string(),
		data: z.object({ object: z.object({ id: z.string() }).passthrough() }).passthrough(),
	})
	.passthrough();

export type StripeEvent = z.infer<typeof StripeEventSchema>;

/** Default Stripe webhook timestamp tolerance — 5 minutes. Matches the Stripe
 * SDK default; trades replay-attack window length for clock-skew tolerance on
 * deployment hosts. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

export type VerifyResult =
	| { ok: true; event: StripeEvent }
	| { ok: false; reason: string };

function parseSignatureHeader(header: string): { timestamp: string; v1: string[] } | undefined {
	const parts = header.split(",");
	let timestamp: string | undefined;
	const v1: string[] = [];
	for (const part of parts) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		const key = part.slice(0, eq);
		const value = part.slice(eq + 1);
		if (key === "t") timestamp = value;
		else if (key === "v1") v1.push(value);
	}
	if (!timestamp || v1.length === 0) return undefined;
	return { timestamp, v1 };
}

function signaturesMatch(expected: string, candidates: readonly string[]): boolean {
	const expectedBuffer = Buffer.from(expected, "utf-8");
	for (const candidate of candidates) {
		if (candidate.length !== expected.length) continue;
		if (timingSafeEqual(expectedBuffer, Buffer.from(candidate, "utf-8"))) return true;
	}
	return false;
}

export function verifyStripeSignature(params: {
	rawBody: Buffer;
	signatureHeader: string;
	secret: string;
	nowSeconds: number;
}): VerifyResult {
	const parsed = parseSignatureHeader(params.signatureHeader);
	if (!parsed) return { ok: false, reason: "malformed-signature-header" };

	const ts = Number(parsed.timestamp);
	if (!Number.isFinite(ts)) return { ok: false, reason: "non-numeric-timestamp" };
	if (Math.abs(params.nowSeconds - ts) > TIMESTAMP_TOLERANCE_SECONDS) {
		return { ok: false, reason: "timestamp-out-of-tolerance" };
	}

	const payload = `${parsed.timestamp}.${params.rawBody.toString("utf-8")}`;
	const expected = createHmac("sha256", params.secret).update(payload).digest("hex");
	if (!signaturesMatch(expected, parsed.v1)) {
		return { ok: false, reason: "signature-mismatch" };
	}

	let body: unknown;
	try {
		body = JSON.parse(params.rawBody.toString("utf-8"));
	} catch {
		return { ok: false, reason: "invalid-json" };
	}
	const eventResult = StripeEventSchema.safeParse(body);
	if (!eventResult.success) return { ok: false, reason: "invalid-event-shape" };
	return { ok: true, event: eventResult.data };
}

