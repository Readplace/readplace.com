import {
	ALIVE_COOKIE_NAME,
	ALIVE_COOKIE_VALUE,
	EXTENSION_LIVENESS_TTL_MS,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import { defineCookie } from "@packages/web-analytics";
import { z } from "zod";

export const extensionAliveCookie = defineCookie({
	name: ALIVE_COOKIE_NAME,
	maxAgeMs: EXTENSION_LIVENESS_TTL_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: z.literal(ALIVE_COOKIE_VALUE),
});

export const extensionSavedCookie = defineCookie({
	name: SAVE_COOKIE_NAME,
	maxAgeMs: EXTENSION_LIVENESS_TTL_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: z.literal(SAVE_COOKIE_VALUE),
});
