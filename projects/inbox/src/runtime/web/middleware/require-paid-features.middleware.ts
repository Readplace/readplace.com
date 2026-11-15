import assert from "node:assert";
import type { RequestHandler } from "express";
import { type GetEffectiveAccess, hasPaidFeatures } from "@packages/subscription-access";
import { SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import { isNonBoostedHtmxRequest } from "../is-non-boosted-htmx-request";

export function initRequirePaidFeatures(deps: { getEffectiveAccess: GetEffectiveAccess }): RequestHandler {
	return async (req, res, next) => {
		assert(req.userId, "requirePaidFeatures must run after an authentication middleware");
		if (hasPaidFeatures(await deps.getEffectiveAccess(req.userId))) {
			next();
			return;
		}
		if (isNonBoostedHtmxRequest(req)) {
			res.status(200).set("HX-Redirect", "/account/plans").type("html").send("");
			return;
		}
		if (req.accepts("html")) {
			res.redirect(303, "/account/plans");
			return;
		}
		res.status(402).json({ error: SAVE_REFUSAL_CODES.paidFeatureRefused });
	};
}
