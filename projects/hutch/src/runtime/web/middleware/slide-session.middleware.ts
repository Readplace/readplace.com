import assert from "node:assert";
import type { RequestHandler } from "express";
import type { Logger } from "@packages/logger";
import type { RenewSession } from "@packages/provider-contracts/auth";
import { SESSION_COOKIE_NAME, isSessionDueForRenewal } from "@packages/web-session";
import { sessionCookie } from "../session-cookie";

export function initSlideSession(deps: {
	renewSession: RenewSession;
	now: () => Date;
	logger: Logger;
	secureCookies: boolean;
}): RequestHandler {
	return async (req, res, next) => {
		if (req.sessionExpiresAt === undefined) {
			next();
			return;
		}
		if (!isSessionDueForRenewal({ sessionExpiresAt: req.sessionExpiresAt, now: deps.now() })) {
			next();
			return;
		}
		const sessionId = req.cookies?.[SESSION_COOKIE_NAME];
		assert(sessionId, "a resolved session must carry its cookie");
		try {
			const outcome = await deps.renewSession({ sessionId });
			if (outcome === "renewed") {
				sessionCookie.set({ res, value: sessionId, secure: deps.secureCookies });
			}
		} catch (error) {
			deps.logger.error("[web-session] session renewal failed; keeping the existing session", { error });
		}
		next();
	};
}
