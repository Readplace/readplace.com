import assert from "node:assert";
import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isbot } from "isbot";
import type { HutchLogger } from "@packages/hutch-logger";
import type { AuthenticatedUserId, UserId } from "@packages/domain/user";
import {
	ANALYTICS_EVENTS,
	INTERNAL_CLICK_MEDIUM,
	type SaveOutcome,
	type SaveSurface,
	type SignupOutcome,
	STREAMS,
} from "./events";
import {
	articleHostFrom,
	classifyContentSource,
	type ContentClass,
} from "./content-source";
import { isSkippedPath } from "./skip-paths";

declare global {
	namespace Express {
		interface Request {
			userId?: AuthenticatedUserId;
		}
	}
}

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
	/**
	 * Bots are already dropped by `shouldLog`, so a logged pageview never
	 * classifies as `bot` — that is what makes the pageview stream a human-device
	 * signal for the audience's device mix, not just article_read's reader cohort.
	 */
	device_class: DeviceClass;
	browser: BrowserFamily;
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
 * the element; `utm_campaign` is intentionally absent. `utm_term` is the
 * optional third dimension a link may carry (e.g. the reader's device class on
 * the queue's reader-view links), so those clicks can be sliced by it.
 */
export interface AnalyticsClick {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.click;
	timestamp: string;
	path: string;
	utm_source?: string;
	utm_medium: typeof INTERNAL_CLICK_MEDIUM;
	utm_content?: string;
	utm_term?: string;
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
	is_authenticated: 0 | 1;
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
	is_authenticated: 0 | 1;
}

/**
 * Coarse device buckets for slicing authenticated reads by cohort. `other`
 * covers an absent User-Agent (no signal); `desktop` is the fallback for a
 * present UA that matches none of the mobile/tablet/bot fingerprints.
 */
export type DeviceClass =
	| "desktop"
	| "mobile_ios"
	| "mobile_android"
	| "tablet"
	| "bot"
	| "other";

/**
 * Derives a `DeviceClass` from the request User-Agent. Only the class is ever
 * returned or logged — the raw UA is discarded here, preserving the no-raw-UA /
 * hashed-IP posture the rest of the analytics layer keeps. Android tablets omit
 * `Mobile` from the UA token, which separates them from Android phones.
 */
export function classifyDeviceClass(userAgent: string | undefined): DeviceClass {
	if (!userAgent) return "other";
	if (isbot(userAgent)) return "bot";
	const isAndroid = userAgent.includes("Android");
	if (userAgent.includes("iPad") || (isAndroid && !userAgent.includes("Mobile"))) return "tablet";
	if (userAgent.includes("iPhone") || userAgent.includes("iPod")) return "mobile_ios";
	if (isAndroid) return "mobile_android";
	return "desktop";
}

/**
 * Browser families for the audience device-mix pie. `other` folds an absent UA,
 * a bot UA, and any browser outside this set into one low-cardinality slice, and
 * preserves the no-raw-UA posture — only the family is logged, never the version
 * or the raw UA.
 */
export type BrowserFamily =
	| "chrome"
	| "safari"
	| "firefox"
	| "edge"
	| "samsung_internet"
	| "opera"
	| "other";

/**
 * Derives a `BrowserFamily` from the User-Agent. Order is the correctness crux:
 * every Chromium UA carries a `Safari/` token and every Chromium *derivative*
 * (Edge, Opera, Samsung) also carries `Chrome/`, so the derivatives match first,
 * then Chrome, then Safari last — otherwise Edge/Opera/Samsung would read as
 * Chrome and every Chromium browser as Safari. iOS wrappers (CriOS/FxiOS/EdgiOS/
 * OPiOS) map to their family, not Safari. The `isbot` guard mirrors
 * classifyDeviceClass: a bot never reaches the pageview log, but Googlebot's
 * smartphone UA embeds a real `Chrome/` token, so the guard stops any future
 * caller from miscounting it.
 */
export function classifyBrowser(userAgent: string | undefined): BrowserFamily {
	if (!userAgent) return "other";
	if (isbot(userAgent)) return "other";
	if (userAgent.includes("Edg/") || userAgent.includes("EdgA/") || userAgent.includes("EdgiOS/")) return "edge";
	if (userAgent.includes("OPR/") || userAgent.includes("OPiOS/")) return "opera";
	if (userAgent.includes("SamsungBrowser/")) return "samsung_internet";
	if (userAgent.includes("FxiOS/") || userAgent.includes("Firefox/")) return "firefox";
	if (userAgent.includes("CriOS/") || userAgent.includes("Chrome/")) return "chrome";
	if (userAgent.includes("Safari/")) return "safari";
	return "other";
}

export interface ArticleReadEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.articleRead;
	timestamp: string;
	user_id: UserId;
	visitor_hash: string | null;
	device_class: DeviceClass;
}

/**
 * Emitted on every TL;DR open/close toggle in the internal authenticated reader
 * (the public reader doesn't record anonymous toggles). `state` distinguishes
 * open from close so the dashboard can count engagement vs dismissals. The
 * durable per-user row holds the latest state; this event carries the 30-day
 * history. `user_id` joins per cohort; `visitor_hash` applies the dashboard's
 * exclusion list.
 */
export interface SummaryToggledEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.summaryToggled;
	timestamp: string;
	user_id: UserId;
	state: "open" | "closed";
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

/**
 * Emitted when a user signals intent to save an article to their queue. Born on
 * the public reader's "Save to My Queue" click — the warmest funnel moment,
 * where an anonymous click redirects to /login and would otherwise vanish — and
 * since extended additively to every other save surface (queue save bar, browser
 * extension) so the funnel can be sliced by `surface` and `outcome`. The event
 * name is kept for backward compatibility even though it now spans surfaces.
 *
 * `content_class` is derived solely from `article_host` (where the saved post
 * lives), never the `referrer_host` (where the click came from): saving a
 * third-party article from our own reader is a third-party save.
 */
export interface ViewSaveIntentEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.viewSaveIntent;
	timestamp: string;
	path: string;
	article_host: string;
	content_class: ContentClass;
	surface: SaveSurface;
	outcome: SaveOutcome;
	referrer_host?: string;
	pending_save_id?: string;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
}

export interface SignupAttemptedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.signupAttempted;
	timestamp: string;
	method: "email";
	outcome: SignupOutcome;
	visitor_hash: string | null;
	visitor_id: string;
	is_authenticated: 0;
}

export type AnalyticsEvent =
	| AnalyticsPageview
	| AnalyticsClick
	| ImportUploadedEvent
	| ImportCommittedEvent
	| ImportFromUrlAcquiredEvent
	| ArticleReadEvent
	| SummaryToggledEvent
	| ViewOpenedEvent
	| ViewSaveIntentEvent
	| SignupAttemptedEvent;

function isRenderedPageStatus(statusCode: number): boolean {
	return (statusCode >= 200 && statusCode < 300) || statusCode === 304;
}

function shouldLog(params: {
	req: Request;
	path: string;
	statusCode: number;
	isStaticAssetPath: (path: string) => boolean;
}): boolean {
	if (params.req.method !== "GET") return false;
	if (isSkippedPath(params.path)) return false;
	if (params.isStaticAssetPath(params.path)) return false;
	if (!isRenderedPageStatus(params.statusCode)) return false;
	if (isbot(params.req.get("user-agent"))) return false;
	if (params.req.get("hx-request") === "true") return false;
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

const suppressedClickResponses = new WeakSet<Response>();

export function suppressClickCount(res: Response): void {
	suppressedClickResponses.add(res);
}

/**
 * Clicks are counted regardless of method or `hx-request` (HTMX-boosted links
 * and POST actions are clicks too); only bots, error responses, and responses
 * a route suppressed via suppressClickCount (the `isbot` UA sniff misses a
 * spoofed User-Agent, but a route that tripped its own bot defense knows
 * better) are dropped. The precise `utm_medium=internal` marker already
 * excludes background polls, which never carry it.
 */
function shouldCountClick(req: Request, res: Response): boolean {
	if (suppressedClickResponses.has(res)) return false;
	if (res.statusCode >= 400) return false;
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

/**
 * Builds a `view_save_intent` event for any save surface. Centralizing the
 * derivation keeps `article_host` (and therefore `content_class`) normalized
 * identically across surfaces and joinable with `view_opened`, and keeps the
 * dedup/exclusion identifiers (`visitor_hash`, `visitor_id`) consistent so the
 * same dashboard exclusions apply to every emission. `referrer_host` is the
 * traffic source, captured separately from `article_host` and never used for
 * `content_class`.
 */
export function buildSaveIntentEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		url: string;
		path: string;
		surface: SaveSurface;
		outcome: SaveOutcome;
		pendingSaveId?: string;
	},
): ViewSaveIntentEvent {
	assert(params.req.visitorId, "visitor-id middleware must run before a save surface emits view_save_intent");
	const articleHost = articleHostFrom(params.url);
	const referrerHost = extractReferrerHost(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.viewSaveIntent,
		timestamp: deps.now().toISOString(),
		path: params.path,
		article_host: articleHost,
		content_class: classifyContentSource(articleHost),
		surface: params.surface,
		outcome: params.outcome,
		...(referrerHost ? { referrer_host: referrerHost } : {}),
		...(params.pendingSaveId ? { pending_save_id: params.pendingSaveId } : {}),
		visitor_hash: hashIp({ ip: params.req.ip, salt: deps.salt }),
		visitor_id: params.req.visitorId,
		is_authenticated: params.req.userId ? 1 : 0,
	};
}

export function buildSignupAttemptedEvent(
	deps: { now: () => Date; salt: string },
	params: { req: Request; outcome: SignupOutcome },
): SignupAttemptedEvent {
	assert(params.req.visitorId, "visitor-id middleware must run before POST /signup emits signup_attempted");
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.signupAttempted,
		timestamp: deps.now().toISOString(),
		method: "email",
		outcome: params.outcome,
		visitor_hash: hashIp({ ip: params.req.ip, salt: deps.salt }),
		visitor_id: params.req.visitorId,
		is_authenticated: 0,
	};
}

export function createAnalyticsMiddleware(deps: {
	logger: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	isStaticAssetPath: (path: string) => boolean;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		/** Capture the request path up front. A sub-router mount (e.g. blog-site's
		 * `/blog`) trims its prefix from req.url before the deferred `finish`
		 * handler runs, so reading req.path there would drop the mount prefix and
		 * misclassify the pageview (and defeat the `/blog/...` SKIP_PATHS). */
		const path = req.path;
		res.on("finish", () => {
			if (isInternalClick(req) && shouldCountClick(req, res)) {
				deps.logger.info({
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.click,
					timestamp: deps.now().toISOString(),
					path,
					utm_source: extractQueryString(req, "utm_source"),
					utm_medium: INTERNAL_CLICK_MEDIUM,
					utm_content: extractQueryString(req, "utm_content"),
					utm_term: extractQueryString(req, "utm_term"),
					visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
					visitor_id: req.visitorId ?? null,
					is_authenticated: req.userId ? 1 : 0,
				});
			}
			if (!shouldLog({ req, path, statusCode: res.statusCode, isStaticAssetPath: deps.isStaticAssetPath })) return;
			const userAgent = req.get("user-agent");
			deps.logger.info({
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.pageview,
				timestamp: deps.now().toISOString(),
				path,
				...extractPageviewUtm(req),
				referrer_host: extractReferrerHost(req),
				medium_post_id: extractMediumPostId(req),
				device_class: classifyDeviceClass(userAgent),
				browser: classifyBrowser(userAgent),
				visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
				visitor_id: req.visitorId ?? null,
				is_authenticated: req.userId ? 1 : 0,
			});
		});
		next();
	};
}
