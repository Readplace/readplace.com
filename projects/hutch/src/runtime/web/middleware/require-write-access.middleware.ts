import assert from "node:assert";
import type { RequestHandler } from "express";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { subscriptionInactiveSirenError } from "../api/subscription-inactive-siren";
import { wantsSiren } from "../content-negotiation";

/**
 * Save-gate for an inactive (read-only) subscription. Content-negotiated like the
 * lock gate: an API/Siren client (the iOS Share Extension, the browser extension,
 * on bearer tokens) gets a 402 carrying a server-authored Siren message it renders
 * generically — so the Share Extension shows a real reason instead of a bare "402".
 * The web gets the inactive banner via the /queue redirect. Reading, listing, and
 * exporting stay open; only a save produces this.
 */
export function initRequireWriteAccess(deps: {
	findSubscriptionByUserId: FindSubscriptionByUserId;
	now: () => Date;
}): RequestHandler {
	return async (req, res, next) => {
		assert(req.userId, "requireWriteAccess must run after an authentication middleware");
		const subscription = await deps.findSubscriptionByUserId(req.userId);
		if (resolveWriteAccess(subscription, deps.now()) === "full") {
			next();
			return;
		}
		if (wantsSiren(req)) {
			res.status(402).type(SIREN_MEDIA_TYPE).json(subscriptionInactiveSirenError());
			return;
		}
		res.redirect(303, "/queue?inactive=1");
	};
}
