import type { NextFunction, Request, Response } from "express";

/** /login is served by hutch on the same origin, so the redirect lands on the
 * real sign-in page even though this deployable never mounts it. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
	if (!req.userId) {
		res.redirect(303, "/login");
		return;
	}
	next();
}
