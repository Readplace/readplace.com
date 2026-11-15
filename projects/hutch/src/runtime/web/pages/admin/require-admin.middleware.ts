import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { FindSessionAdminMfaVerifiedAt, FindUserByEmail } from "@packages/provider-contracts/auth";
import { SESSION_COOKIE_NAME, readCookie } from "@packages/web-session";
import type { RefuseAdminAccess } from "./admin-forbidden.page";

export const ADMIN_MFA_PATH = "/admin/mfa";

const ADMIN_MFA_MAX_AGE_SECONDS = 12 * 60 * 60;

export type SecondFactorPolicy =
	| { kind: "enforced"; findSessionAdminMfaVerifiedAt: FindSessionAdminMfaVerifiedAt; now: () => Date }
	| { kind: "being-challenged" };

export type ServiceTokenPolicy = { kind: "refused" } | { kind: "accepted"; token: string };

export function serviceTokenPolicy(token: string): ServiceTokenPolicy {
	if (token === "") return { kind: "refused" };
	return { kind: "accepted", token };
}

export interface RequireAdminDeps {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	serviceToken: ServiceTokenPolicy;
	secondFactor: SecondFactorPolicy;
	refuse: RefuseAdminAccess;
}

function constantTimeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function findAllowlistedAdminEmail(deps: {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	userId: string;
}): Promise<string | undefined> {
	for (const email of deps.adminEmails) {
		const user = await deps.findUserByEmail(email);
		if (user && user.userId === deps.userId) return email;
	}
	return undefined;
}

async function hasPassedSecondFactor(req: Request, secondFactor: SecondFactorPolicy): Promise<boolean> {
	if (secondFactor.kind === "being-challenged") return true;
	const sessionId = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
	if (sessionId === undefined) return false;
	const verifiedAt = await secondFactor.findSessionAdminMfaVerifiedAt(sessionId);
	if (verifiedAt === undefined) return false;
	return Math.floor(secondFactor.now().getTime() / 1000) - verifiedAt < ADMIN_MFA_MAX_AGE_SECONDS;
}

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
		const adminEmail = await findAllowlistedAdminEmail({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			userId: req.userId,
		});
		if (adminEmail === undefined) {
			await deps.refuse(req, res);
			return;
		}
		if (!(await hasPassedSecondFactor(req, deps.secondFactor))) {
			res.redirect(303, ADMIN_MFA_PATH);
			return;
		}
		next();
	};
}
