import assert from "node:assert";
import type { RequestHandler } from "express";
import type { FindSubscriptionByUserId } from "@packages/provider-contracts/subscription-providers";
import { resolveWriteAccess } from "@packages/subscription-access";
import { isNonBoostedHtmxRequest } from "../is-non-boosted-htmx-request";

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
		if (isNonBoostedHtmxRequest(req)) {
			res.status(200).set("HX-Redirect", "/queue?inactive=1").type("html").send("");
			return;
		}
		if (req.accepts("html")) {
			res.redirect(303, "/queue?inactive=1");
			return;
		}
		res.status(402).json({ error: "subscription_inactive" });
	};
}
