import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type { MarkSubscriptionCancelled } from "@packages/test-fixtures/providers/subscription-providers";

const StripeEventSchema = z
	.object({
		type: z.string(),
		data: z.object({ object: z.object({ id: z.string() }).passthrough() }).passthrough(),
	})
	.passthrough();

/** Default Stripe webhook timestamp tolerance — 5 minutes. Matches the Stripe
 * SDK default; trades replay-attack window length for clock-skew tolerance on
 * deployment hosts. */
const TIMESTAMP_TOLERANCE_SECONDS = 300;

type VerifyResult =
	| { ok: true; event: z.infer<typeof StripeEventSchema> }
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

function verifyStripeSignature(params: {
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

	const eventResult = StripeEventSchema.safeParse(JSON.parse(params.rawBody.toString("utf-8")));
	if (!eventResult.success) return { ok: false, reason: "invalid-event-shape" };
	return { ok: true, event: eventResult.data };
}

/** Test-only signing helper for fixture-driven integration tests. Mirrors the
 * `t=<unix_ts>,v1=<hex_hmac_sha256>` header format Stripe sends so unit tests
 * can construct valid headers without pulling in the Stripe SDK. */
export function signStripeWebhookHeader(params: {
	rawBody: Buffer;
	secret: string;
	timestampSeconds: number;
}): string {
	const payload = `${params.timestampSeconds}.${params.rawBody.toString("utf-8")}`;
	const signature = createHmac("sha256", params.secret).update(payload).digest("hex");
	return `t=${params.timestampSeconds},v1=${signature}`;
}

export function initStripeWebhookRoutes(deps: {
	webhookSecret: string;
	markCancelled: MarkSubscriptionCancelled;
	logger: HutchLogger;
	now: () => Date;
}): Router {
	const router = express.Router();

	/** Synchronous API-Gateway-fronted Lambda — Stripe expects a 2xx within
	 * seconds. This is the allowed exception in the infrastructure-design skill
	 * to the SQS-backed-Lambda rule: API Gateway is the queue analogue and 5xx
	 * surfaces back to Stripe so it retries on its own schedule.
	 *
	 * Mounted before any global JSON body parser — Stripe signature verification
	 * needs the unmodified raw request bytes. */
	router.post(
		"/",
		express.raw({ type: "application/json" }),
		async (req: Request, res: Response) => {
			const signatureHeader = req.header("Stripe-Signature");
			if (!signatureHeader) {
				res.status(400).type("text/plain").send("Missing signature");
				return;
			}

			const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
			const verifyResult = verifyStripeSignature({
				rawBody,
				signatureHeader,
				secret: deps.webhookSecret,
				nowSeconds: Math.floor(deps.now().getTime() / 1000),
			});

			if (!verifyResult.ok) {
				deps.logger.warn("[stripe-webhook] invalid signature", { reason: verifyResult.reason });
				res.status(400).type("text/plain").send("Bad signature");
				return;
			}

			const event = verifyResult.event;
			if (event.type === "customer.subscription.deleted") {
				const subscriptionId = event.data.object.id;
				try {
					await deps.markCancelled({ subscriptionId });
					deps.logger.info("[stripe-webhook] cancelled", { subscriptionId });
				} catch (err) {
					deps.logger.warn("[stripe-webhook] unknown subscription, ignoring", {
						subscriptionId,
						error: err instanceof Error ? err.message : String(err),
					});
				}
			}
			/** Other event types are acknowledged with 200 so Stripe stops retrying.
			 * Adding new handlers means extending the switch; do NOT 4xx unknown
			 * events — that would block unrelated webhooks from settling. */

			res.status(200).type("text/plain").send("");
		},
	);

	return router;
}
