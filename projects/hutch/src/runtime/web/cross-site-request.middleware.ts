import type { NextFunction, Request, RequestHandler, Response } from "express";
import { SESSION_COOKIE_NAME } from "@packages/web-session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BROWSER_OWN_REQUEST = new Set(["same-origin", "none"]);

function isCrossSite(req: Request, appOrigin: string): boolean {
	const fetchSite = req.get("Sec-Fetch-Site");
	if (fetchSite !== undefined) return !BROWSER_OWN_REQUEST.has(fetchSite);
	const origin = req.get("Origin");
	return origin !== undefined && origin !== appOrigin;
}

export function createCrossSiteRequestMiddleware(deps: { appOrigin: string }): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		const ridesOnSessionCookie =
			!SAFE_METHODS.has(req.method) &&
			req.cookies?.[SESSION_COOKIE_NAME] !== undefined &&
			req.get("Authorization") === undefined;
		if (ridesOnSessionCookie && isCrossSite(req, deps.appOrigin)) {
			res.sendStatus(403);
			return;
		}
		next();
	};
}
