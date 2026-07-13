import { baseCookieOptions } from "@packages/web-analytics";
import { SESSION_COOKIE_MAX_AGE_MS } from "@packages/web-session";

export const persistentSessionCookieOptions = (secure: boolean) => ({
	...baseCookieOptions(secure),
	maxAge: SESSION_COOKIE_MAX_AGE_MS,
});
