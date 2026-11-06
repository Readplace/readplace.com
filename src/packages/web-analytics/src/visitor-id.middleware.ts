import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { defineCookie } from "./define-cookie";

export const VISITOR_COOKIE_NAME = "hutch_vid";

/** A year — long enough to survive the 30-day click-attribution window so a
 * returning visitor keeps the same identity across multiple campaigns. */
const VISITOR_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const visitorIdCookie = defineCookie({
	name: VISITOR_COOKIE_NAME,
	maxAgeMs: VISITOR_COOKIE_MAX_AGE_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: z.string(),
});

/** Brand the opaque first-party id so it cannot be confused with a UserId or a
 * raw query string at a call site. */
const VisitorIdSchema = z.string().uuid().brand<"VisitorId">();
export type VisitorId = z.infer<typeof VisitorIdSchema>;

declare global {
	namespace Express {
		interface Request {
			visitorId?: VisitorId;
		}
	}
}

/**
 * A cookie that fails validation is treated as absent so the middleware mints a
 * fresh id rather than propagating a tampered value into analytics.
 */
export function readVisitorId(req: Request): VisitorId | undefined {
	const raw = req.cookies?.[VISITOR_COOKIE_NAME];
	if (typeof raw !== "string") return undefined;
	const result = VisitorIdSchema.safeParse(raw);
	return result.success ? result.data : undefined;
}

export function createVisitorIdMiddleware(deps: {
	generateVisitorId: () => string;
	secure: boolean;
	isStaticAssetPath: (path: string) => boolean;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		if (deps.isStaticAssetPath(req.path)) {
			next();
			return;
		}
		const existing = readVisitorId(req);
		if (existing) {
			req.visitorId = existing;
			next();
			return;
		}
		const visitorId = VisitorIdSchema.parse(deps.generateVisitorId());
		req.visitorId = visitorId;
		visitorIdCookie.set({ res, value: visitorId, secure: deps.secure });
		next();
	};
}
