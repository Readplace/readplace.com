import type { CookieOptions } from "express";
import { z } from "zod";
import { baseCookieOptions } from "@packages/web-analytics";

export const LAST_AUTH_PROVIDER_COOKIE_NAME = "hutch_lastauth";

const LastAuthProviderSchema = z.enum(["google", "apple"]);

export type LastAuthProvider = z.infer<typeof LastAuthProviderSchema>;

const LAST_AUTH_PROVIDER_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function setLastAuthProvider(
	deps: {
		res: { cookie: (name: string, value: string, options: CookieOptions) => void };
		secure: boolean;
	},
	provider: LastAuthProvider,
): void {
	deps.res.cookie(LAST_AUTH_PROVIDER_COOKIE_NAME, provider, {
		...baseCookieOptions(deps.secure),
		maxAge: LAST_AUTH_PROVIDER_COOKIE_MAX_AGE_MS,
	});
}

export function readLastAuthProvider(req: {
	cookies?: Record<string, unknown>;
}): LastAuthProvider | undefined {
	const parsed = LastAuthProviderSchema.safeParse(req.cookies?.[LAST_AUTH_PROVIDER_COOKIE_NAME]);
	if (!parsed.success) return undefined;
	return parsed.data;
}
