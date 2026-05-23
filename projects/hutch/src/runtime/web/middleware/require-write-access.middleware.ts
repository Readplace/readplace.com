import assert from "node:assert";
import type { RequestHandler } from "express";
import type { GetEffectiveAccess } from "../../domain/access/effective-access";

export function initRequireWriteAccess(deps: {
	getEffectiveAccess: GetEffectiveAccess;
}): RequestHandler {
	return async (req, res, next) => {
		assert(req.userId, "requireWriteAccess must run after an authentication middleware");
		const result = await deps.getEffectiveAccess(req.userId);
		if (result.access === "full") {
			next();
			return;
		}
		if (req.accepts("html")) {
			res.redirect(303, "/queue?inactive=1");
			return;
		}
		res.status(402).json({ error: "subscription_inactive" });
	};
}
