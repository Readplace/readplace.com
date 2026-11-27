import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import { extractQueryString, extractReferrerHost } from "./countable-request";
import { defineCookie } from "./define-cookie";
import { isSkippedPath } from "./skip-paths";

export const CLICK_COOKIE_NAME = "hutch_click";
const CLICK_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const clickAttributionCookie = defineCookie({
	name: CLICK_COOKIE_NAME,
	maxAgeMs: CLICK_COOKIE_MAX_AGE_MS,
	sameSite: "lax",
	httpOnly: true,
	schema: z.string(),
});
const MAX_UTM_VALUE_LENGTH = 256;

export const ClickAttributionSchema = z.object({
	utm_source: z.string().optional(),
	utm_medium: z.string().optional(),
	utm_campaign: z.string().optional(),
	utm_content: z.string().optional(),
	referrer_host: z.string().optional(),
	first_seen_at: z.string(),
	landing_path: z.string(),
});

export type ClickAttribution = z.infer<typeof ClickAttributionSchema>;

function extractUtmValue(req: Request, name: string): string | undefined {
	return extractQueryString(req, name)?.slice(0, MAX_UTM_VALUE_LENGTH);
}

/**
 * A cookie that fails schema validation is treated as absent so the middleware
 * can re-attribute on the next eligible request rather than locking the user
 * into a corrupted value.
 */
export function readClickAttribution(req: Request): ClickAttribution | undefined {
	const raw = req.cookies?.[CLICK_COOKIE_NAME];
	if (typeof raw !== "string") return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	const result = ClickAttributionSchema.safeParse(parsed);
	return result.success ? result.data : undefined;
}

export function createClickAttributionMiddleware(deps: {
	now: () => Date;
	secure: boolean;
	isStaticAssetPath: (path: string) => boolean;
	canonicalizeLandingPath: (path: string) => string;
	ownHost: string;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		if (req.method !== "GET") {
			next();
			return;
		}
		if (isSkippedPath(req.path)) {
			next();
			return;
		}
		if (deps.isStaticAssetPath(req.path)) {
			next();
			return;
		}
		if (readClickAttribution(req)) {
			next();
			return;
		}

		const utm_source = extractUtmValue(req, "utm_source");
		const utm_medium = extractUtmValue(req, "utm_medium");
		const utm_campaign = extractUtmValue(req, "utm_campaign");
		const utm_content = extractUtmValue(req, "utm_content");
		const host = extractReferrerHost(req);
		const referrer_host = host === deps.ownHost ? undefined : host;

		/** Set the cookie on first GET regardless of attribution so organic
		 * landings still carry `landing_path` / `first_seen_at` on the eventual
		 * conversion event. Optional fields are omitted to keep the
		 * no-attribution cookie minimal. */
		const attribution: ClickAttribution = {
			first_seen_at: deps.now().toISOString(),
			landing_path: deps.canonicalizeLandingPath(req.path),
			...(utm_source ? { utm_source } : {}),
			...(utm_medium ? { utm_medium } : {}),
			...(utm_campaign ? { utm_campaign } : {}),
			...(utm_content ? { utm_content } : {}),
			...(referrer_host ? { referrer_host } : {}),
		};

		clickAttributionCookie.set({ res, value: JSON.stringify(attribution), secure: deps.secure });
		next();
	};
}
