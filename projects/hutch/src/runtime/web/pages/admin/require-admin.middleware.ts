import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import type { RefuseAdminAccess } from "./admin-forbidden.page";

export type ServiceTokenPolicy = { kind: "refused" } | { kind: "accepted"; token: string };

export function serviceTokenPolicy(token: string): ServiceTokenPolicy {
	if (token === "") return { kind: "refused" };
	return { kind: "accepted", token };
}

export interface RequireAdminDeps {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	serviceToken: ServiceTokenPolicy;
	refuse: RefuseAdminAccess;
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
 * An unmatched header falls through to the session check.
 */
export function initRequireAdmin(deps: RequireAdminDeps) {
	return async (
		req: Request,
		res: Response,
		next: NextFunction,
	): Promise<void> => {
		const headerToken = req.headers["x-service-token"];
		if (
			deps.serviceToken.kind === "accepted" &&
			typeof headerToken === "string" &&
			constantTimeEquals(headerToken, deps.serviceToken.token)
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
		await deps.refuse(req, res);
	};
}
