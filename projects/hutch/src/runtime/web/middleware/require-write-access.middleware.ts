import assert from "node:assert";
import type { RequestHandler } from "express";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";
import { SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { subscriptionInactiveSirenError } from "../api/subscription-inactive-siren";
import { wantsSiren } from "../content-negotiation";
import { tagSaveRefusal } from "../shared/save-refusal";

export function hasFullWriteAccess(input: {
	subscription: Parameters<typeof resolveWriteAccess>[0];
	now: Date;
}): boolean {
	return resolveWriteAccess(input.subscription, input.now) === "full";
}

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
		if (hasFullWriteAccess({ subscription, now: deps.now() })) {
			next();
			return;
		}
		tagSaveRefusal(res, SAVE_REFUSAL_CODES.noWriteAccess);
		if (wantsSiren(req)) {
			res.status(402).type(SIREN_MEDIA_TYPE).json(subscriptionInactiveSirenError());
			return;
		}
		res.redirect(303, "/queue?inactive=1");
	};
}
