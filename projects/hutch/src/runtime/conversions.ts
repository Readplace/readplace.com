import { createHash } from "node:crypto";
import type { HutchLogger } from "@packages/hutch-logger";
import type { UserId } from "@packages/domain/user";
import type { ConversionEvent } from "@packages/provider-contracts/auth";
import type { ClickAttribution } from "@packages/web-analytics";
import { CONVERSION_EVENTS, STREAMS } from "./observability/events";

export type { ConversionEvent };

function hashEmail(email: string): string {
	return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

/**
 * Attribution is device-scoped — a signup completed in a different browser from
 * the one that drove the click will carry no attribution on the event.
 */
export function emitUserCreated(
	deps: {
		logger: HutchLogger.Typed<ConversionEvent>;
		now: () => Date;
	},
	params: {
		userId: UserId;
		email: string;
		method: "email" | "google" | "apple";
		tier: "free" | "trial";
		attribution: ClickAttribution | undefined;
		visitorId?: string;
		homepageVariant?: string;
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
		...(params.attribution ?? {}),
		...(params.visitorId ? { visitor_id: params.visitorId } : {}),
		...(params.homepageVariant ? { homepage_variant: params.homepageVariant } : {}),
		...(params.pendingSaveId ? { pending_save_id: params.pendingSaveId } : {}),
	};
	deps.logger.info(event);
}
