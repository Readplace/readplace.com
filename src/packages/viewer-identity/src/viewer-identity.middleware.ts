import type { NextFunction, Request, RequestHandler, Response } from "express";
import { initResolveViewerIdentity, isTrustedEdge, VIEWER_PATH_HEADER } from "./viewer-identity";

export function createViewerIdentityMiddleware(deps: { edgeSecret: string }): RequestHandler {
	const resolveViewerIdentity = initResolveViewerIdentity(deps);
	return (req: Request, res: Response, next: NextFunction) => {
		const path = req.headers[VIEWER_PATH_HEADER];
		if (path !== undefined && isTrustedEdge(req, deps.edgeSecret)) {
			// Only the internal reader endpoint accepts preserved paths. Query bytes
			// belong to the outer request and must never be parsed and reserialized.
			if (
				typeof path !== "string" ||
				!/^\/view\//i.test(path) ||
				/[^\x21-\x7e]|[?#]/.test(path) ||
				!/^\/view(?:\?|$)/.test(req.url)
			) {
				res.status(400).send("Bad Request");
				return;
			}
			const queryStart = req.url.indexOf("?");
			const query = queryStart === -1 ? "" : req.url.slice(queryStart);
			req.url = path + query;
			req.originalUrl = req.url;
		}
		req.viewer = resolveViewerIdentity(req);
		next();
	};
}
