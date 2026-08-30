import assert from "node:assert";
import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isbot } from "isbot";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type { AuthenticatedUserId, UserId } from "@packages/domain/user";
import { type ViewerIp, viewerOf } from "@packages/viewer-identity";
import {
	ANALYTICS_EVENTS,
	INTERNAL_CLICK_MEDIUM,
	type McpToolOutcome,
	SAVE_CLIENTS,
	SAVE_LINK_SURFACES,
	SAVE_SURFACE_QUERY,
	SAVE_SURFACES,
	OAUTH_TOKEN_REFUSAL_REASONS,
	type OAuthTokenGrantType,
	type OAuthTokenRefusalReason,
	type SaveRefusalCode,
	type SaveClient,
	type SaveOutcome,
	type SaveSurface,
	type SignupOutcome,
	STREAMS,
} from "./events";
import {
	articleHostFromSubmitted,
	classifyContentSource,
	type ContentClass,
} from "./content-source";
import { gatewayRequestIdOf } from "./gateway-request-id";
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
	/** The experiment this render was an exposure for, and the arm it drew. Set
	 * by `tagPageviewExperiment` when the arm is chosen server-side, so the
	 * exposure rides the page the visitor already requested instead of a
	 * redirect's utm params — the visitor's own `utm_*` keep meaning acquisition. */
	experiment?: string;
	experiment_variant?: string;
	sort_order?: "asc" | "desc";
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
 * One anchored arm per shipped native app, so a bot UA that merely mentions our
 * app never matches. iOS sends the stock URLSession UA (two binaries — the app
 * and its share extension); Android replaces OkHttp's default with a UA of the
 * same `Product/version` shape, since `okhttp/x` identifies nothing.
 */
const NATIVE_CLIENT_USER_AGENTS = {
	ios: /^(?:Readplace|ShareExtension)\/\d+ CFNetwork\/[\d.]+ Darwin\/[\d.]+$/,
	android: /^Readplace\/\d+ Android\/[\d.]+$/,
} as const;

/** Which native app sent this User-Agent, or undefined for anything else. */
export function readplaceNativeClientOf(userAgent: string | undefined): "ios" | "android" | undefined {
	if (userAgent === undefined) return undefined;
	if (NATIVE_CLIENT_USER_AGENTS.ios.test(userAgent)) return "ios";
	if (NATIVE_CLIENT_USER_AGENTS.android.test(userAgent)) return "android";
	return undefined;
}

export function isReadplaceNativeClient(userAgent: string | undefined): boolean {
	return readplaceNativeClientOf(userAgent) !== undefined;
}

export function isBotUserAgent(userAgent: string | undefined): boolean {
	if (isReadplaceNativeClient(userAgent)) return false;
	return isbot(userAgent);
}

/**
 * Derives a `DeviceClass` from the request User-Agent. Only the class is ever
 * returned or logged — the raw UA is discarded here, preserving the no-raw-UA /
 * hashed-IP posture the rest of the analytics layer keeps. Android tablets omit
 * `Mobile` from the UA token, which separates them from Android phones.
 */
export function classifyDeviceClass(userAgent: string | undefined): DeviceClass {
	if (!userAgent) return "other";
	const nativeClient = readplaceNativeClientOf(userAgent);
	if (nativeClient === "ios") return "mobile_ios";
	if (nativeClient === "android") return "mobile_android";
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
 * history. `user_id` joins per cohort.
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
 * Carries `visitor_id` so it joins to the `user_created` conversion per device.
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
 * the public reader's "Save to My Readlist" click — the warmest funnel moment,
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
	article_host: string | null;
	content_class: ContentClass | null;
	surface: SaveSurface;
	outcome: SaveOutcome;
	client: SaveClient;
	device_class: DeviceClass;
	browser: BrowserFamily;
	referrer_host?: string;
	pending_save_id?: string;
	request_id?: string;
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

/**
 * Emitted server-side the instant a new signup's first article is auto-saved
 * into their otherwise-empty queue, exactly once per trigger. A discrete 1:1
 * activation signal that does not lean on the `utm_source=signup-autosave`
 * marker surviving on the post-signup `/queue` pageview — a reload, share, or
 * bookmark of that URL would recount the marker, but this event fires only at
 * the signup redirect decision. `user_id` joins to the resulting `article_read`;
 * `visitor_id` joins to the follow-on `view_save_intent` that persists the save.
 */
export interface FirstArticleAutosavedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.firstArticleAutosaved;
	timestamp: string;
	user_id: UserId;
	article_host: string;
	visitor_hash: string | null;
	visitor_id?: string;
}

export interface McpToolCalledEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.mcpToolCalled;
	timestamp: string;
	tool: string;
	outcome: McpToolOutcome;
	oauth_client_id: string;
	user_id: UserId;
	sort_order?: "asc" | "desc";
	article_host?: string;
	content_class?: ContentClass;
}

export interface OAuthTokenIssuedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.oauthTokenIssued;
	timestamp: string;
	grant_type: OAuthTokenGrantType;
	client_id: string;
	request_id?: string;
	visitor_hash: string | null;
}

export interface OAuthTokenRefusedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.oauthTokenRefused;
	timestamp: string;
	grant_type: OAuthTokenGrantType;
	client_id: string;
	status: number;
	reason: OAuthTokenRefusalReason;
	request_id?: string;
	visitor_hash: string | null;
}

export interface SaveRefusedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.saveRefused;
	timestamp: string;
	path: string;
	code: SaveRefusalCode;
	status: number;
	client: SaveClient;
	is_authenticated: 0 | 1;
	request_id?: string;
	visitor_hash: string | null;
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
	| SignupAttemptedEvent
	| FirstArticleAutosavedEvent
	| McpToolCalledEvent
	| OAuthTokenIssuedEvent
	| OAuthTokenRefusedEvent
	| SaveRefusedEvent;

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
	if (isBotUserAgent(params.req.get("user-agent"))) return false;
	if (isPrefetch(params.req)) return false;
	if (extractReferrerHost(params.req) === params.ownHost) return false;
	return isBrowserClient(params.req);
}

function shouldLog(params: {
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

const pageviewExperiments = new WeakMap<Response, { experiment: string; variant: string }>();

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

const pageviewSortOrders = new WeakMap<Response, "asc" | "desc" | undefined>();

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
function shouldCountClick(params: { req: Request; res: Response; ownHost: string }): boolean {
	if (suppressedClickResponses.has(params.res)) return false;
	if (params.res.statusCode >= 400) return false;
	return isCountableBrowserRequest({ req: params.req, ownHost: params.ownHost });
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

export function buildSaveRefusedEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		path: string;
		status: number;
		code: SaveRefusalCode;
		client: SaveClient;
	},
): SaveRefusedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.saveRefused,
		timestamp: deps.now().toISOString(),
		path: params.path,
		code: params.code,
		status: params.status,
		client: params.client,
		is_authenticated: params.req.userId ? 1 : 0,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function buildOAuthTokenIssuedEvent(
	deps: { now: () => Date; salt: string },
	params: { req: Request; grantType: OAuthTokenGrantType; clientId: string },
): OAuthTokenIssuedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.oauthTokenIssued,
		timestamp: deps.now().toISOString(),
		grant_type: params.grantType,
		client_id: params.clientId,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function buildOAuthTokenRefusedEvent(
	deps: { now: () => Date; salt: string },
	params: { req: Request; grantType: OAuthTokenGrantType; clientId: string; status: number },
): OAuthTokenRefusedEvent {
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.oauthTokenRefused,
		timestamp: deps.now().toISOString(),
		grant_type: params.grantType,
		client_id: params.clientId,
		status: params.status,
		reason:
			params.status === 429
				? OAUTH_TOKEN_REFUSAL_REASONS.rateLimited
				: OAUTH_TOKEN_REFUSAL_REASONS.rejected,
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
	};
}

export function hashIp(deps: { ip: ViewerIp | undefined; salt: string }): string | null {
	if (!deps.ip) return null;
	return createHash("sha256")
		.update(deps.ip + deps.salt)
		.digest("hex")
		.slice(0, 16);
}

const SaveLinkSurfaceSchema = z.enum(SAVE_LINK_SURFACES);

export function deriveSaveSurface(req: Request): SaveSurface {
	const parsed = SaveLinkSurfaceSchema.safeParse(req.query[SAVE_SURFACE_QUERY]);
	return parsed.success ? parsed.data : SAVE_SURFACES.unknown;
}

/**
 * Builds a `view_save_intent` event for any save surface. Centralizing the
 * derivation keeps `article_host` (and therefore `content_class`) normalized
 * identically across surfaces and joinable with `view_opened`, and keeps the
 * dedup/exclusion identifier (`visitor_id`) consistent so the same dashboard
 * exclusions apply to every emission. `referrer_host` is the traffic source,
 * captured separately from `article_host` and never used for `content_class`.
 */
export function buildSaveIntentEvent(
	deps: { now: () => Date; salt: string },
	params: {
		req: Request;
		url: string;
		path: string;
		surface: SaveSurface;
		outcome: SaveOutcome;
		client: SaveClient;
		pendingSaveId?: string;
	},
): ViewSaveIntentEvent {
	assert(params.req.visitorId, "visitor-id middleware must run before a save surface emits view_save_intent");
	const articleHost = articleHostFromSubmitted(params.url);
	const referrerHost = extractReferrerHost(params.req);
	const userAgent = params.req.get("user-agent");
	const gatewayRequestId = gatewayRequestIdOf(params.req);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.viewSaveIntent,
		timestamp: deps.now().toISOString(),
		path: params.path,
		article_host: articleHost,
		content_class: articleHost === null ? null : classifyContentSource(articleHost),
		surface: params.surface,
		outcome: params.outcome,
		client: params.client,
		device_class: classifyDeviceClass(userAgent),
		browser: classifyBrowser(userAgent),
		...(referrerHost ? { referrer_host: referrerHost } : {}),
		...(params.pendingSaveId ? { pending_save_id: params.pendingSaveId } : {}),
		...(gatewayRequestId === undefined ? {} : { request_id: gatewayRequestId }),
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
		visitor_id: params.req.visitorId,
		is_authenticated: params.req.userId ? 1 : 0,
	};
}

export function buildMcpToolCalledEvent(
	deps: { now: () => Date },
	params: {
		tool: string;
		outcome: McpToolOutcome;
		oauthClientId: string;
		userId: UserId;
		submittedUrl?: string;
		sortOrder?: "asc" | "desc";
	},
): McpToolCalledEvent {
	const articleHost =
		params.submittedUrl === undefined
			? null
			: articleHostFromSubmitted(params.submittedUrl);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.mcpToolCalled,
		timestamp: deps.now().toISOString(),
		tool: params.tool,
		outcome: params.outcome,
		oauth_client_id: params.oauthClientId,
		user_id: params.userId,
		sort_order: params.sortOrder,
		...(articleHost === null
			? {}
			: {
					article_host: articleHost,
					content_class: classifyContentSource(articleHost),
				}),
	};
}

export function buildMcpSaveIntentEvent(
	deps: { now: () => Date },
	params: { url: string; path: string; outcome: SaveOutcome },
): ViewSaveIntentEvent {
	const articleHost = articleHostFromSubmitted(params.url);
	return {
		stream: STREAMS.analytics,
		event: ANALYTICS_EVENTS.viewSaveIntent,
		timestamp: deps.now().toISOString(),
		path: params.path,
		article_host: articleHost,
		content_class: articleHost === null ? null : classifyContentSource(articleHost),
		surface: SAVE_SURFACES.mcp,
		outcome: params.outcome,
		client: SAVE_CLIENTS.mcp,
		device_class: classifyDeviceClass(undefined),
		browser: classifyBrowser(undefined),
		visitor_hash: null,
		visitor_id: null,
		is_authenticated: 1,
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
		visitor_hash: hashIp({ ip: viewerOf(params.req).ip, salt: deps.salt }),
		visitor_id: params.req.visitorId,
		is_authenticated: 0,
	};
}

export function createAnalyticsMiddleware(deps: {
	logger: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	isStaticAssetPath: (path: string) => boolean;
	ownHost: string;
}): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		/** Capture the request path up front. A sub-router mount (e.g. blog-site's
		 * `/blog`) trims its prefix from req.url before the deferred `finish`
		 * handler runs, so reading req.path there would drop the mount prefix and
		 * misclassify the pageview (and defeat the `/blog/...` SKIP_PATHS). */
		const path = req.path;
		res.on("finish", () => {
			if (isInternalClick(req) && shouldCountClick({ req, res, ownHost: deps.ownHost })) {
				deps.logger.info({
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.click,
					timestamp: deps.now().toISOString(),
					path,
					utm_source: extractQueryString(req, "utm_source"),
					utm_medium: INTERNAL_CLICK_MEDIUM,
					utm_content: extractQueryString(req, "utm_content"),
					utm_term: extractQueryString(req, "utm_term"),
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					visitor_id: req.visitorId ?? null,
					is_authenticated: req.userId ? 1 : 0,
				});
			}
			if (
				!shouldLog({
					req,
					path,
					statusCode: res.statusCode,
					isStaticAssetPath: deps.isStaticAssetPath,
					ownHost: deps.ownHost,
				})
			)
				return;
			const userAgent = req.get("user-agent");
			const exposure = pageviewExperiments.get(res);
			deps.logger.info({
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.pageview,
				timestamp: deps.now().toISOString(),
				path,
				...extractPageviewUtm(req),
				referrer_host: extractReferrerHost(req),
				medium_post_id: extractMediumPostId(req),
				experiment: exposure?.experiment,
				experiment_variant: exposure?.variant,
				sort_order: pageviewSortOrders.get(res),
				device_class: classifyDeviceClass(userAgent),
				browser: classifyBrowser(userAgent),
				visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
				visitor_id: req.visitorId ?? null,
				is_authenticated: req.userId ? 1 : 0,
			});
		});
		next();
	};
}
