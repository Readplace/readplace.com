import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import type { UserId } from "@packages/domain/user";
import type { ConversionEvent } from "@packages/test-fixtures/providers/auth";
import type { ClickAttribution } from "./web/click-attribution.middleware";

export type { ConversionEvent };

function hashEmail(email: string): string {
	return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Emits a single user_created event for every signup — both free and paid.
 * For paid signups the Stripe checkout session id is included so the event
 * can be cross-joined with Stripe payment data downstream. Attribution is
 * the first-touch click cookie at the moment of signup; the cookie is
 * device-scoped so a user who pays from a different browser than they
 * landed on will have no attribution on their paid event.
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
		tier: "free" | "paid";
		stripeCheckoutSessionId?: string;
		attribution: ClickAttribution | undefined;
	},
): void {
	const event: ConversionEvent = {
		stream: "conversions",
		event: "user_created",
		timestamp: deps.now().toISOString(),
		user_id: params.userId,
		email_hash: hashEmail(params.email),
		method: params.method,
		tier: params.tier,
		...(params.stripeCheckoutSessionId
			? { stripe_checkout_session_id: params.stripeCheckoutSessionId }
			: {}),
		...(params.attribution ?? {}),
	};
	deps.logger.info(event);
}
