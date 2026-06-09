import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isbot } from "isbot";
import type { HutchLogger } from "@packages/hutch-logger";
import type { UserId } from "@packages/domain/user";
import { ANALYTICS_EVENTS, INTERNAL_CLICK_MEDIUM, STREAMS } from "../../observability/events";

export interface AnalyticsPageview {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.pageview;
	timestamp: string;
	path: string;
	utm_source?: string;
	utm_medium?: string;
	utm_campaign?: string;
	utm_content?: string;
	referrer_host?: string;
	medium_post_id?: string;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
}

/**
 * A click on an in-site link or action button. Every internal href/form action
 * carries `utm_medium=internal`; this event is emitted for any request bearing
 * it — including HTMX-boosted navigations and POST actions (Save / Delete /
 * Mark-read / Logout) that the pageview path drops — so click volume is
 * countable across all surfaces. `utm_source` is the section and `utm_content`
 * the element; `utm_campaign` is intentionally absent.
 */
export interface AnalyticsClick {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.click;
	timestamp: string;
	path: string;
	utm_source?: string;
	utm_medium: typeof INTERNAL_CLICK_MEDIUM;
	utm_content?: string;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
}

export interface ImportUploadedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.importUploaded;
	timestamp: string;
	path: "/import";
	utm_source: "import-feature";
	utm_medium: "form";
	utm_campaign: "file-upload";
	url_count: number;
	truncated: 0 | 1;
	visitor_hash: string | null;
	is_authenticated: 1;
}

export interface ImportCommittedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.importCommitted;
	timestamp: string;
	path: "/import/commit";
	utm_source: "import-feature";
	utm_medium: "form";
	utm_campaign: "submit";
	imported_count: number;
	skipped_count: number;
	total_in_session: number;
	visitor_hash: string | null;
	is_authenticated: 1;
}

export interface ImportFromUrlAcquiredEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.importFromUrlAcquired;
	timestamp: string;
	path: "/import/from-url";
	utm_source: "import-feature";
	utm_medium: "form";
	utm_campaign: "from-url";
	url_count: number;
	truncated: 0 | 1;
	visitor_hash: string | null;
	is_authenticated: 1;
}

export interface ArticleReadEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.articleRead;
	timestamp: string;
	user_id: UserId;
	visitor_hash: string | null;
}

/**
 * Anonymous "try the reader" opens are invisible to the pageview middleware —
 * the homepage form GET /view 302→/view/<url> and the reader's htmx polls carry
 * `hx-request`, all dropped by `shouldLog`. This event is emitted directly from
 * the /view handler so the activation step is countable, and carries
 * `visitor_id` so it joins to the `user_created` conversion per device.
 */
export interface ViewOpenedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.viewOpened;
	timestamp: string;
	path: string;
	article_host: string;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
}

/** Emitted when a visitor clicks "Save to My Queue" on the public reader — the
 * warmest moment in the funnel. Anonymous clicks redirect to /login (a separate
 * surface), so this event is the only record that the intent occurred. */
export interface ViewSaveIntentEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.viewSaveIntent;
	timestamp: string;
	path: string;
	article_host: string;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
}

export type AnalyticsEvent =
	| AnalyticsPageview
	| AnalyticsClick
	| ImportUploadedEvent
	| ImportCommittedEvent
	| ImportFromUrlAcquiredEvent
	| ArticleReadEvent
	| ViewOpenedEvent
	| ViewSaveIntentEvent;

const SKIP_PATHS = new Set([
	"/robots.txt",
	"/sitemap.xml",
	"/llms.txt",
	"/favicon.ico",
]);

function shouldLog(req: Request, statusCode: number): boolean {
	if (req.method !== "GET") return false;
	if (SKIP_PATHS.has(req.path)) return false;
	if (statusCode >= 400) return false;
	if (isbot(req.get("user-agent"))) return false;
	if (req.get("hx-request") === "true") return false;
	return true;
}

/**
 * Returns undefined (not null) for missing/empty params so JSON.stringify
 * drops the key from the emitted payload — null would serialize as
 * "utm_source":null and waste ~80 bytes on every no-UTM pageview.
 */
function extractQueryString(req: Request, name: string): string | undefined {
	const value = req.query[name];
	return typeof value === "string" && value !== "" ? value : undefined;
}

function extractReferrerHost(req: Request): string | undefined {
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
function extractMediumPostId(req: Request): string | undefined {
	const source = req.query.source;
	if (typeof source !== "string") return undefined;
	const match = source.match(/^post_page-----([A-Za-z0-9]+)/);
	return match ? match[1] : undefined;
}

function isInternalClick(req: Request): boolean {
	return extractQueryString(req, "utm_medium") === INTERNAL_CLICK_MEDIUM;
}

/**
 * Clicks are counted regardless of method or `hx-request` (HTMX-boosted links
 * and POST actions are clicks too); only bots and error responses are dropped.
 * The precise `utm_medium=internal` marker already excludes background polls,
 * which never carry it.
 */
function shouldCountClick(req: Request, statusCode: number): boolean {
	if (statusCode >= 400) return false;
	if (isbot(req.get("user-agent"))) return false;
	return true;
}

/**
 * Internal navigation is recorded as a `click`; keeping its `utm_medium=internal`
 * out of the pageview preserves the meaning of the acquisition dashboards, which
 * group pageviews by the real campaign source.
 */
function extractPageviewUtm(
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

export function hashIp(deps: { ip: string | undefined; salt: string }): string | null {
	if (!deps.ip) return null;
	return createHash("sha256")
		.update(deps.ip + deps.salt)
		.digest("hex")
		.slice(0, 16);
}

export function createAnalyticsMiddleware(deps: {
	logger: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		res.on("finish", () => {
			if (isInternalClick(req) && shouldCountClick(req, res.statusCode)) {
				deps.logger.info({
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.click,
					timestamp: deps.now().toISOString(),
					path: req.path,
					utm_source: extractQueryString(req, "utm_source"),
					utm_medium: INTERNAL_CLICK_MEDIUM,
					utm_content: extractQueryString(req, "utm_content"),
					visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
					visitor_id: req.visitorId ?? null,
					is_authenticated: req.userId ? 1 : 0,
				});
			}
			if (!shouldLog(req, res.statusCode)) return;
			deps.logger.info({
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.pageview,
				timestamp: deps.now().toISOString(),
				path: req.path,
				...extractPageviewUtm(req),
				referrer_host: extractReferrerHost(req),
				medium_post_id: extractMediumPostId(req),
				visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
				visitor_id: req.visitorId ?? null,
				is_authenticated: req.userId ? 1 : 0,
			});
		});
		next();
	};
}
