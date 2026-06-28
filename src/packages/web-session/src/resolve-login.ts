import type { AuthenticatedUserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GetSessionUserId } from "@packages/provider-contracts/auth";
import { readCookie } from "./cookie";
import { SESSION_COOKIE_NAME } from "./session-cookie";

/** A request's resolved login standing. The extension point for future
 * capabilities ("what the user can do"): today it carries identity only, but new
 * fields hang off the `isAuthenticated: true` arm without touching call sites
 * that only branch on `isAuthenticated`. */
export type LoginState =
	| { isAuthenticated: true; userId: AuthenticatedUserId; emailVerified: boolean }
	| { isAuthenticated: false };

const GUEST: LoginState = { isAuthenticated: false };

export type ResolveLogin = (cookieHeader: string | undefined) => Promise<LoginState>;

/** Turns a raw `Cookie:` header into a LoginState. Two resilience properties
 * keep this safe on public SEO pages:
 *
 * 1. No cookie → guest with no DB call. Logged-out crawlers are the bulk of
 *    blog/embed traffic, so the absent-cookie short-circuit keeps them off the
 *    session table entirely.
 * 2. A lookup error → logged + guest, never thrown. A DynamoDB blip must not
 *    500 a public page; degrading to the guest nav is the correct, invisible
 *    fallback. The logger is required (no noop default) so the blip is never
 *    swallowed silently. */
export function initResolveLogin(deps: {
	getSessionUserId: GetSessionUserId;
	logger: HutchLogger;
}): ResolveLogin {
	return async (cookieHeader) => {
		const sessionId = readCookie(cookieHeader, SESSION_COOKIE_NAME);
		if (!sessionId) return GUEST;
		try {
			const session = await deps.getSessionUserId(sessionId);
			if (!session) return GUEST;
			return {
				isAuthenticated: true,
				userId: session.userId,
				emailVerified: session.emailVerified,
			};
		} catch (error) {
			deps.logger.error("[web-session] session lookup failed; resolving as guest", { error });
			return GUEST;
		}
	};
}
