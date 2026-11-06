import { defineCookie } from "@packages/web-analytics";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

export const LISTING_GENERATION_COOKIE_NAME = "hutch_gen";

const listingGenerationCookie = defineCookie({
	name: LISTING_GENERATION_COOKIE_NAME,
	maxAgeMs: "browser-session",
	sameSite: "lax",
	httpOnly: true,
	schema: z.string(),
});

export function createListingGenerationMiddleware(deps: {
	nextGeneration: () => string;
	secure: boolean;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			listingGenerationCookie.set({ res, value: deps.nextGeneration(), secure: deps.secure });
		}
		next();
	};
}
