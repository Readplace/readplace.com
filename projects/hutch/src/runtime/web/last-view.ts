import type { Response } from "express";
import { defineCookie } from "@packages/web-analytics";
import { z } from "zod";

export const LAST_VIEW_COOKIE_NAME = "hutch_lastview";

const LAST_VIEW_COOKIE_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const lastViewCookie = defineCookie({
	name: LAST_VIEW_COOKIE_NAME,
	maxAgeMs: LAST_VIEW_COOKIE_MAX_AGE_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: z.string(),
});

export function setLastViewUrl(deps: { res: Response; secure: boolean }, url: string): void {
	lastViewCookie.set({ res: deps.res, value: url, secure: deps.secure });
}

export function readLastViewUrl(req: { cookies?: Record<string, unknown> }): string | undefined {
	return lastViewCookie.read(req);
}
