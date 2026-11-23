import { type RequestHandler, Router } from "express";
import { wantsSiren } from "./content-negotiation";

export function forBearerSirenRequests(...handlers: RequestHandler[]): RequestHandler {
	const bearerRequests = Router();
	bearerRequests.use(handlers);
	return (req, res, next) => {
		if (wantsSiren(req) && req.headers.authorization?.startsWith("Bearer ")) {
			return bearerRequests(req, res, next);
		}
		next();
	};
}
