import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

export const CLICK_COOKIE_NAME = "hutch_click";
const CLICK_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const ClickAttributionSchema = z.object({
	utm_source: z.string().optional(),
	utm_medium: z.string().optional(),
	utm_campaign: z.string().optional(),
	utm_content: z.string().optional(),
	referrer_host: z.string().optional(),
	first_seen_at: z.string(),
	landing_path: z.string(),
});

export type ClickAttribution = z.infer<typeof ClickAttributionSchema>;

const COOKIE_OPTIONS = {
	httpOnly: true,
	sameSite: "lax" as const,
	path: "/",
	maxAge: CLICK_COOKIE_MAX_AGE_MS,
};

function extractQueryString(req: Request, name: string): string | undefined {
	const value = req.query[name];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function extractReferrerHost(req: Request): string | undefined {
	const referer = req.get("referer");
	if (!referer) return undefined;
	try {
		const hostname = new URL(referer).hostname;
		if (hostname === req.hostname) return undefined;
		return hostname;
	} catch {
		return undefined;
	}
}

/**
 * Returns the parsed click attribution stored on the request cookie, or
 * undefined if no valid attribution exists. A cookie that fails schema
 * validation is treated as absent so the middleware can re-attribute on the
 * next eligible request rather than locking the user into a corrupted value.
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

/**
 * Captures first-touch attribution as a 30-day cookie. On a GET request that
 * carries any utm_* param OR an external referrer, and where no valid
 * attribution cookie is already set, this writes a JSON-encoded cookie with
 * the UTM params, referrer host, landing path, and first-seen timestamp.
 * Once written, subsequent UTM hits do not overwrite it — first-touch wins.
 */
export function createClickAttributionMiddleware(deps: {
	now: () => Date;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		if (req.method !== "GET") {
			next();
			return;
		}
		if (readClickAttribution(req)) {
			next();
			return;
		}

		const utm_source = extractQueryString(req, "utm_source");
		const utm_medium = extractQueryString(req, "utm_medium");
		const utm_campaign = extractQueryString(req, "utm_campaign");
		const utm_content = extractQueryString(req, "utm_content");
		const referrer_host = extractReferrerHost(req);

		if (!utm_source && !utm_medium && !utm_campaign && !utm_content && !referrer_host) {
			next();
			return;
		}

		const attribution: ClickAttribution = {
			first_seen_at: deps.now().toISOString(),
			landing_path: req.path,
			...(utm_source ? { utm_source } : {}),
			...(utm_medium ? { utm_medium } : {}),
			...(utm_campaign ? { utm_campaign } : {}),
			...(utm_content ? { utm_content } : {}),
			...(referrer_host ? { referrer_host } : {}),
		};

		res.cookie(CLICK_COOKIE_NAME, JSON.stringify(attribution), COOKIE_OPTIONS);
		next();
	};
}
