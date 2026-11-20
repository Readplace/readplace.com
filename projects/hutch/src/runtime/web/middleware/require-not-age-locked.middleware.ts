import type { Request, RequestHandler } from "express";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";
import { Base } from "../base.component";
import { ageAccessSirenError } from "../api/age-access-siren";
import { SIREN_MEDIA_TYPE } from "../api/siren";
import { wantsSiren } from "../content-negotiation";
import { ACCOUNT_DELETE_URL, ACCOUNT_EXPORT_URL } from "../pages/account/account.url";
import { AgePausedPage } from "../pages/age-lock/age-lock.component";
import { AGE_UNLOCK_PATH } from "../pages/age-lock/age-lock.url";

function isReachableWhilePaused(req: Pick<Request, "method" | "path">): boolean {
	if (req.path === AGE_UNLOCK_PATH) return true;
	if (req.path === ACCOUNT_EXPORT_URL || req.path.startsWith(`${ACCOUNT_EXPORT_URL}/`)) return true;
	return req.method === "POST" && (req.path === ACCOUNT_DELETE_URL || req.path === "/logout");
}

export const requireNotAgeLocked: RequestHandler = (req, res, next) => {
	if (!req.ageLocked || isReachableWhilePaused(req)) {
		next();
		return;
	}
	if (wantsSiren(req)) {
		res.status(403).type(SIREN_MEDIA_TYPE).json(ageAccessSirenError("accountPaused"));
		return;
	}
	sendComponent(req, res, Base(AgePausedPage(), bannerStateFromRequest(req)));
};
