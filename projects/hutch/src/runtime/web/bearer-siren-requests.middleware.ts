import type { RequestHandler } from "express";
import { wantsSiren } from "./content-negotiation";

export function forBearerSirenRequests(handler: RequestHandler): RequestHandler {
	return (req, res, next) => {
		if (wantsSiren(req) && req.headers.authorization?.startsWith("Bearer ")) {
			return handler(req, res, next);
		}
		next();
	};
}
