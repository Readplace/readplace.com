import assert from "node:assert";
import type { RequestHandler } from "express";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { sendComponent } from "@packages/web-shell";
import { HxRedirectPage } from "../../hx-redirect-page";
import { INTEGRATIONS_PATH } from "./gmail-connect.url";
import { canConnectGmail } from "./gmail-connection-access";

export function initRequireGmailConnectionAccess(deps: {
	getEffectiveAccess: GetEffectiveAccess;
}): RequestHandler {
	return async (req, res, next) => {
		assert(req.userId, "Gmail connection access must run after authentication");
		if (canConnectGmail(await deps.getEffectiveAccess(req.userId))) {
			next();
			return;
		}
		if (req.get("HX-Request") === "true") {
			sendComponent(req, res, HxRedirectPage(INTEGRATIONS_PATH));
			return;
		}
		res.redirect(303, INTEGRATIONS_PATH);
	};
}
