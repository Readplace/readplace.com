import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import type { UserId } from "@packages/domain/user";
import type { ConversionEvent } from "@packages/provider-contracts/auth";
import type { ClickAttribution } from "./web/click-attribution.middleware";
import { CONVERSION_EVENTS, STREAMS } from "./observability/events";

export type { ConversionEvent };

function hashEmail(email: string): string {
	return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Stripe checkout session id is included so events can be cross-joined with
 * payment data downstream. Attribution is device-scoped — a user who pays from
 * a different browser will have no attribution on their paid event.
 */
export function emitUserCreated(
	deps: {
		logger: HutchLogger.Typed<ConversionEvent>;
		now: () => Date;
	},
	params: {
		userId: UserId;
		email: string;
		method: "email" | "google";
		tier: "free" | "paid" | "trial";
		stripeCheckoutSessionId?: string;
		attribution: ClickAttribution | undefined;
		visitorId?: string;
		pendingSaveId?: string;
	},
): void {
	const event: ConversionEvent = {
		stream: STREAMS.conversions,
		event: CONVERSION_EVENTS.userCreated,
		timestamp: deps.now().toISOString(),
		user_id: params.userId,
		email_hash: hashEmail(params.email),
		method: params.method,
		tier: params.tier,
		...(params.stripeCheckoutSessionId
			? { stripe_checkout_session_id: params.stripeCheckoutSessionId }
			: {}),
		...(params.attribution ?? {}),
		...(params.visitorId ? { visitor_id: params.visitorId } : {}),
		...(params.pendingSaveId ? { pending_save_id: params.pendingSaveId } : {}),
	};
	deps.logger.info(event);
}
