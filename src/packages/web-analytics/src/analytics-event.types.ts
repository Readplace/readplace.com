import type { UserId } from "@packages/domain/user";
import type {
	ANALYTICS_EVENTS,
	INTERNAL_CLICK_MEDIUM,
	KeepOfferSurface,
	McpRequestRefusalReason,
	McpToolOutcome,
	McpUaClient,
	OAuthTokenKind,
	OAuthTokenRevocationOutcome,
	OAuthTokenGrantType,
	OAuthTokenRefusalReason,
	PageExitKind,
	PlansPageTerms,
	UnsubscribeSource,
	QueueDigestUnsubscribeMethod,
	SaveRefusalCode,
	SaveClient,
	SaveOutcome,
	SaveSurface,
	SignupOutcome,
	STREAMS,
} from "./events";
import type { ContentClass } from "./content-source";
import type { BrowserFamily, DeviceClass, OsFamily } from "./user-agent";

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
	 * The pageview stream is a device signal for the audience's device mix, not
	 * just article_read's reader cohort.
	 */
	device_class: DeviceClass;
	browser: BrowserFamily;
	os_family: OsFamily;
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
	device_class: DeviceClass;
	browser: BrowserFamily;
	os_family: OsFamily;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
}

export interface AnalyticsEmailClick {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.emailClick;
	timestamp: string;
	path: string;
	status_code: number;
	utm_source?: string;
	utm_campaign?: string;
	utm_content?: string;
	utm_term?: string;
	device_class: DeviceClass;
	browser: BrowserFamily;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
	user_id: UserId | null;
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

export interface ArticleReadEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.articleRead;
	timestamp: string;
	user_id: UserId;
	visitor_hash: string | null;
	device_class: DeviceClass;
	opened_in_reader: boolean;
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

export interface ViewCrawlLimitedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.viewCrawlLimited;
	timestamp: string;
	path: string;
	article_host: string;
	visitor_hash: string | null;
	visitor_id: string;
	is_authenticated: 0;
}

export interface EpubImagesOverBudgetEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.epubImagesOverBudget;
	timestamp: string;
	path: string;
	article_host: string;
	skipped_count: number;
	skipped_bytes: number;
	embedded_bytes: number;
	visitor_id: string;
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

export type McpSaveIntentEvent = ViewSaveIntentEvent & { user_id: UserId };

export interface ViewEndCtaShownEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.viewEndCtaShown;
	timestamp: string;
	path: string;
	article_host: string;
	device_class: DeviceClass;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0;
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
	user_id?: UserId;
	request_id?: string;
	visitor_hash: string | null;
}

export interface KeepOfferEventFields {
	stream: typeof STREAMS.analytics;
	timestamp: string;
	user_id: UserId;
	surface: KeepOfferSurface;
	trial_day: number;
	request_id?: string;
	visitor_hash: string | null;
}

export interface KeepOfferShownEvent extends KeepOfferEventFields {
	event: typeof ANALYTICS_EVENTS.keepOfferShown;
}

export interface KeepOfferClickedEvent extends KeepOfferEventFields {
	event: typeof ANALYTICS_EVENTS.keepOfferClicked;
}

/**
 * How much of a page a reader actually reached before leaving it. Recorded so a
 * section that draws no clicks can be told apart from one nobody ever scrolled
 * to — the two look identical in the click stream, and the difference decides
 * whether the section needs rewriting or moving up.
 *
 * Every measurement is in CSS pixels, taken at the moment of leaving so a page
 * whose height settles late (a web font, a poster frame) is measured at its
 * final height rather than its first-paint one.
 */
export interface PageDepthEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.pageDepth;
	timestamp: string;
	path: string;
	/** Bottom of the viewport at its deepest, so a reader who never scrolls is
	 * credited with the screenful they did see. */
	deepest_px: number;
	page_height_px: number;
	viewport_height_px: number;
	/** The part of the page that never came into view. */
	unseen_px: number;
	seen_percent: number;
	exit_kind: PageExitKind;
	device_class: DeviceClass;
	visitor_hash: string | null;
	visitor_id: string | null;
	is_authenticated: 0 | 1;
}

export interface PlansPageViewedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.plansPageViewed;
	timestamp: string;
	user_id: UserId;
	tier: "founding" | "paid" | "trial" | "inactive";
	terms: PlansPageTerms;
	utm_source?: string;
	utm_campaign?: string;
	utm_term?: string;
}

export interface QueueDigestUnsubscribedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.queueDigestUnsubscribed;
	timestamp: string;
	user_id: UserId;
	method: QueueDigestUnsubscribeMethod;
	kind?: UnsubscribeSource;
}

export interface McpRequestRefusedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.mcpRequestRefused;
	timestamp: string;
	status: number;
	reason: McpRequestRefusalReason;
	ua_client: McpUaClient;
	offered_protocol_version?: string;
	oauth_client_id?: string;
	user_id?: UserId;
	request_id?: string;
	visitor_hash: string | null;
}

export interface McpSessionInitializedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.mcpSessionInitialized;
	timestamp: string;
	oauth_client_id: string;
	user_id: UserId;
	client_protocol_version?: string;
	client_name?: string;
	client_version?: string;
}

export interface McpToolsListedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.mcpToolsListed;
	timestamp: string;
	oauth_client_id: string;
	user_id: UserId;
	tool_count: number;
	ua_client: McpUaClient;
}

export interface OAuthTokenRevokedEvent {
	stream: typeof STREAMS.analytics;
	event: typeof ANALYTICS_EVENTS.oauthTokenRevoked;
	timestamp: string;
	client_id: string;
	grant_id?: string;
	outcome: OAuthTokenRevocationOutcome;
	token_kind: OAuthTokenKind;
	request_id?: string;
	visitor_hash: string | null;
}

export type AnalyticsEvent =
	| AnalyticsPageview
	| AnalyticsClick
	| AnalyticsEmailClick
	| ImportUploadedEvent
	| ImportCommittedEvent
	| ImportFromUrlAcquiredEvent
	| ArticleReadEvent
	| SummaryToggledEvent
	| ViewOpenedEvent
	| ViewCrawlLimitedEvent
	| ViewSaveIntentEvent
	| ViewEndCtaShownEvent
	| SignupAttemptedEvent
	| FirstArticleAutosavedEvent
	| McpToolCalledEvent
	| OAuthTokenIssuedEvent
	| OAuthTokenRefusedEvent
	| SaveRefusedEvent
	| KeepOfferShownEvent
	| KeepOfferClickedEvent
	| PageDepthEvent
	| PlansPageViewedEvent
	| QueueDigestUnsubscribedEvent
	| McpRequestRefusedEvent
	| McpSessionInitializedEvent
	| McpToolsListedEvent
	| OAuthTokenRevokedEvent
	| EpubImagesOverBudgetEvent;
