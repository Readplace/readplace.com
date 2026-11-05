import type { Request, Response } from "express";
import { EMAIL_CLICK_MEDIUM, INTERNAL_CLICK_MEDIUM } from "./events";
import { isSkippedPath } from "./skip-paths";
import type { AnalyticsPageview } from "./analytics-event.types";
import { isBotRequest } from "./user-agent";

function isRenderedPageStatus(statusCode: number): boolean {
	return (statusCode >= 200 && statusCode < 300) || statusCode === 304;
}

function declaresChromium(userAgent: string): boolean {
	return userAgent.includes("Chrome/") || userAgent.includes("Chromium/");
}

function isBrowserClient(req: Request): boolean {
	const userAgent = req.get("user-agent");
	if (!userAgent) return false;
	if (!req.get("accept-language")) return false;
	if (declaresChromium(userAgent) && !req.get("sec-ch-ua")) return false;
	return true;
}

function isPrefetch(req: Request): boolean {
	const purpose = req.get("sec-purpose");
	if (!purpose) return false;
	return purpose.includes("prefetch");
}

function isTopLevelNavigation(req: Request): boolean {
	if (req.get("sec-fetch-mode") !== "navigate") return false;
	if (req.get("sec-fetch-dest") !== "document") return false;
	return true;
}

/**
 * `ownHost` is the host this deployable serves, as `new URL(appOrigin).hostname`
 * — port-less, to match what `extractReferrerHost` derives from the header. Every
 * app response carries helmet's default `Referrer-Policy: no-referrer`, so a
 * conforming browser navigating *within* the site sends no `Referer` at all — a
 * request whose referrer is our own host therefore cannot have come from one.
 * Inbound referrers from other hosts are governed by those hosts' policies and
 * stay countable, which is what keeps genuine acquisition traffic measurable.
 */
export function isCountableBrowserRequest(params: { req: Request; ownHost: string }): boolean {
	if (extractReferrerHost(params.req) === params.ownHost) return false;
	return isCountableBrowserClient(params.req);
}

function isCountableBrowserClient(req: Request): boolean {
	if (isBotRequest(req)) return false;
	if (isPrefetch(req)) return false;
	return isBrowserClient(req);
}

export function shouldLog(params: {
	req: Request;
	path: string;
	statusCode: number;
	isStaticAssetPath: (path: string) => boolean;
	ownHost: string;
}): boolean {
	if (params.req.method !== "GET") return false;
	if (isSkippedPath(params.path)) return false;
	if (params.isStaticAssetPath(params.path)) return false;
	if (!isRenderedPageStatus(params.statusCode)) return false;
	if (params.req.get("hx-request") === "true") return false;
	if (!isCountableBrowserRequest({ req: params.req, ownHost: params.ownHost })) return false;
	if (!isTopLevelNavigation(params.req)) return false;
	return true;
}

/**
 * Returns undefined (not null) for missing/empty params so JSON.stringify
 * drops the key from the emitted payload — null would serialize as
 * "utm_source":null and waste ~80 bytes on every no-UTM pageview.
 */
export function extractQueryString(req: Request, name: string): string | undefined {
	const value = req.query[name];
	return typeof value === "string" && value !== "" ? value : undefined;
}

export function extractReferrerHost(req: Request): string | undefined {
	const referer = req.get("referer");
	if (!referer) return undefined;
	try {
		return new URL(referer).hostname;
	} catch {
		return undefined;
	}
}

/**
 * Medium attaches `source=post_page-----<id>---------------------------------------`
 * to every outbound link from a post. The 12-char alnum segment after
 * `post_page-----` is the post's canonical Medium identifier — same one Medium
 * uses for `https://medium.com/p/<id>`. We capture only the ID (not the
 * trailing dashes) so the dashboard's group-by key is the post itself.
 */
export function extractMediumPostId(req: Request): string | undefined {
	const source = req.query.source;
	if (typeof source !== "string") return undefined;
	const match = source.match(/^post_page-----([A-Za-z0-9]+)/);
	return match ? match[1] : undefined;
}

export function isInternalClick(req: Request): boolean {
	return extractQueryString(req, "utm_medium") === INTERNAL_CLICK_MEDIUM;
}

export function isEmailClick(req: Request): boolean {
	return extractQueryString(req, "utm_medium") === EMAIL_CLICK_MEDIUM;
}

const suppressedClickResponses = new WeakSet<Response>();

export function suppressClickCount(res: Response): void {
	suppressedClickResponses.add(res);
}

export const pageviewExperiments = new WeakMap<Response, { experiment: string; variant: string }>();

/** Marks this response as an exposure to an experiment arm, so the pageview
 * emitted on finish carries which arm rendered. A route that picks the arm
 * itself has no arm-specific URL for the middleware to read, and the visitor's
 * own `utm_*` must keep describing where they came from. */
export function tagPageviewExperiment(
	res: Response,
	exposure: { experiment: string; variant: string },
): void {
	pageviewExperiments.set(res, exposure);
}

export const pageviewSortOrders = new WeakMap<Response, "asc" | "desc" | undefined>();

/** Marks this response with the sort order the reader explicitly asked for, so
 * the pageview says which order rendered. Undefined is stored deliberately:
 * absence in the emitted event means the reader took the default, which is what
 * separates "asked for newest" from "never asked". */
export function tagPageviewSortOrder(
	res: Response,
	order: "asc" | "desc" | undefined,
): void {
	pageviewSortOrders.set(res, order);
}

/**
 * Clicks are counted regardless of method or `hx-request` (HTMX-boosted links
 * and POST actions are clicks too); only error responses, responses a route
 * suppressed via suppressClickCount (a route that tripped its own bot defense
 * knows more than the UA sniff does), and requests that fail
 * `isCountableBrowserRequest` are dropped. Navigation shape is deliberately not
 * checked: an HTMX-boosted click sends `sec-fetch-dest: empty`, so requiring a
 * top-level navigation here would zero out every boosted click. The precise
 * `utm_medium=internal` marker already excludes background polls.
 */
export function shouldCountClick(params: { req: Request; res: Response; ownHost: string }): boolean {
	if (!isCountableClickResponse(params.res)) return false;
	return isCountableBrowserRequest({ req: params.req, ownHost: params.ownHost });
}

function isCountableClickResponse(res: Response): boolean {
	if (suppressedClickResponses.has(res)) return false;
	return res.statusCode < 400;
}

export function shouldCountEmailClick(params: { req: Request; res: Response; ownHost: string }): boolean {
	if (!params.req.userId) return shouldCountClick(params);
	if (!isCountableClickResponse(params.res)) return false;
	return isCountableBrowserClient(params.req);
}

/**
 * Internal navigation is recorded as a `click`; keeping its `utm_medium=internal`
 * out of the pageview preserves the meaning of the acquisition dashboards, which
 * group pageviews by the real campaign source.
 */
export function extractPageviewUtm(
	req: Request,
): Pick<AnalyticsPageview, "utm_source" | "utm_medium" | "utm_campaign" | "utm_content"> {
	if (isInternalClick(req)) return {};
	return {
		utm_source: extractQueryString(req, "utm_source"),
		utm_medium: extractQueryString(req, "utm_medium"),
		utm_campaign: extractQueryString(req, "utm_campaign"),
		utm_content: extractQueryString(req, "utm_content"),
	};
}
