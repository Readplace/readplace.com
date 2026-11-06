import { defineCookie } from "@packages/web-analytics";
import { SESSION_COOKIE_MAX_AGE_MS, SESSION_COOKIE_NAME } from "@packages/web-session";
import { z } from "zod";

export const sessionCookie = defineCookie({
	name: SESSION_COOKIE_NAME,
	maxAgeMs: SESSION_COOKIE_MAX_AGE_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: z.string(),
});

export const persistentSessionCookieOptions = sessionCookie.options;
