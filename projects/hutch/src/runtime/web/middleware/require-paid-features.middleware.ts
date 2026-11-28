import assert from "node:assert";
import type { RequestHandler } from "express";
import { type GetEffectiveAccess, hasPaidFeatures } from "@packages/subscription-access";
import { SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import { paidFeatureSirenError } from "../api/paid-feature-siren";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { wantsSiren } from "../content-negotiation";
import { redirectFullPage } from "../hx-redirect-page";
import { ACCOUNT_PLANS_URL } from "../pages/account/account.url";
import { tagSaveRefusal } from "../shared/save-refusal";

export function initRequirePaidFeatures(deps: {
	getEffectiveAccess: GetEffectiveAccess;
}): RequestHandler {
	return async (req, res, next) => {
		assert(req.userId, "requirePaidFeatures must run after an authentication middleware");
		if (hasPaidFeatures(await deps.getEffectiveAccess(req.userId))) {
			next();
			return;
		}
		tagSaveRefusal(res, SAVE_REFUSAL_CODES.paidFeatureRefused);
		if (wantsSiren(req)) {
			res.status(402).type(SIREN_MEDIA_TYPE).json(paidFeatureSirenError());
			return;
		}
		redirectFullPage(req, res, ACCOUNT_PLANS_URL);
	};
}
