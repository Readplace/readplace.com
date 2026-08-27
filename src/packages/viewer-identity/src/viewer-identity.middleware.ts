import type { NextFunction, Request, RequestHandler, Response } from "express";
import { initResolveViewerIdentity } from "./viewer-identity";

export function createViewerIdentityMiddleware(deps: { edgeSecret: string }): RequestHandler {
	const resolveViewerIdentity = initResolveViewerIdentity(deps);
	return (req: Request, _res: Response, next: NextFunction) => {
		req.viewer = resolveViewerIdentity(req);
		next();
	};
}
