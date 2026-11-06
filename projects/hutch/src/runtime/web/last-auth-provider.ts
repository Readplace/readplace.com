import type { CookieOptions } from "express";
import { z } from "zod";
import { defineCookie } from "@packages/web-analytics";

export const LAST_AUTH_PROVIDER_COOKIE_NAME = "hutch_lastauth";

const LastAuthProviderSchema = z.enum(["google", "apple"]);

export type LastAuthProvider = z.infer<typeof LastAuthProviderSchema>;

const LAST_AUTH_PROVIDER_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const lastAuthProviderCookie = defineCookie({
	name: LAST_AUTH_PROVIDER_COOKIE_NAME,
	maxAgeMs: LAST_AUTH_PROVIDER_COOKIE_MAX_AGE_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: LastAuthProviderSchema,
});

export function setLastAuthProvider(
	deps: {
		res: { cookie: (name: string, value: string, options: CookieOptions) => void };
		secure: boolean;
	},
	provider: LastAuthProvider,
): void {
	lastAuthProviderCookie.set({ res: deps.res, value: provider, secure: deps.secure });
}

export function readLastAuthProvider(req: {
	cookies?: Record<string, unknown>;
}): LastAuthProvider | undefined {
	return lastAuthProviderCookie.read(req);
}
