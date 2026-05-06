import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { FindUserByEmail } from "@packages/test-fixtures/providers/auth";

export interface RequireAdminDeps {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	/**
	 * Shared secret accepted via the `x-service-token` header for server-to-
	 * server callers (e.g. the Tier 1+ crawl pipeline health workflow). Empty
	 * string disables this auth path entirely so a misconfigured env cannot
	 * silently accept header-less requests.
	 */
	serviceToken: string;
}

function constantTimeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Gate for operator-only routes. Accepts either:
 *   1. a valid `x-service-token` header (server-to-server caller), OR
 *   2. a populated session cookie (req.userId) whose user matches one of the
 *      allowlisted emails.
 *
 * Session-less human requests → 303 /login. Authenticated non-admin → 403.
 * An empty `serviceToken` disables the S2S path (fail-closed); an unmatched
 * header falls through to the session check.
 */
export function initRequireAdmin(deps: RequireAdminDeps) {
	return async (
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		const headerToken = req.headers["x-service-token"];
		if (
			typeof headerToken === "string" &&
			deps.serviceToken.length > 0 &&
			constantTimeEquals(headerToken, deps.serviceToken)
		) {
			next();
			return;
		}

		if (!req.userId) {
			res.redirect(303, "/login");
			return;
		}
		for (const email of deps.adminEmails) {
			const user = await deps.findUserByEmail(email);
			if (user && user.userId === req.userId) {
				next();
				return;
			}
		}
		res
			.status(403)
			.type("html")
			.send(
				"<!doctype html><title>403 Forbidden</title><p>Admin access required.</p>",
			);
	};
}
