import { baseCookieOptions } from "@packages/web-analytics";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export const LISTING_GENERATION_COOKIE_NAME = "hutch_gen";

export function createListingGenerationMiddleware(deps: {
	nextGeneration: () => string;
	secure: boolean;
}): RequestHandler {
	const cookieOptions = baseCookieOptions(deps.secure);
	return (req: Request, res: Response, next: NextFunction) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.cookie(LISTING_GENERATION_COOKIE_NAME, deps.nextGeneration(), cookieOptions);
		}
		next();
	};
}
