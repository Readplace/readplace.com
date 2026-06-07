import type { NextFunction, Request, Response } from "express";

/** RFC 9727 §3 lets agents discover the API catalog from any resource via a Link header, so they need no prior knowledge of the well-known path. rel="api-catalog" is registered in the IANA Link Relations registry by RFC 9727. */
export const API_CATALOG_LINK = '</.well-known/api-catalog>; rel="api-catalog"';

export function linkHeaderMiddleware(req: Request, res: Response, next: NextFunction): void {
	if (req.method === "GET") {
		res.set("Link", API_CATALOG_LINK);
	}
	next();
}
