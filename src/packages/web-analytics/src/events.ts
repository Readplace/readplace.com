import { PARSE_ERROR_STREAM, CRAWL_OUTCOME_STREAM } from "@packages/hutch-infra-components";

/**
 * Single source of truth for log stream names. Every analytics-style log line
 * carries a `stream` field with one of these values; the dashboards filter on
 * it via `filter stream = "<name>"`. The same import is used by emitters
 * (analytics middleware, conversion emitter, subscription handlers) so a
 * rename here surfaces as a TypeScript error at every call site.
 */
export const STREAMS = {
	analytics: "analytics",
	conversions: "conversions",
	parseErrors: PARSE_ERROR_STREAM,
	crawlOutcomes: CRAWL_OUTCOME_STREAM,
	subscriptions: "subscriptions",
} as const;

export const ANALYTICS_EVENTS = {
	pageview: "pageview",
	click: "click",
	importUploaded: "import_uploaded",
	importFromUrlAcquired: "import_from_url_acquired",
	importCommitted: "import_committed",
	articleRead: "article_read",
	summaryToggled: "summary_toggled",
	viewOpened: "view_opened",
	viewSaveIntent: "view_save_intent",
	signupAttempted: "signup_attempted",
} as const;

/**
 * Terminal outcomes of a POST /signup submission, emitted so the signup form's
 * own conversion (submissions → accounts) is measurable and the cost of each
 * rejection gate is separable. `disposable_email` is split out from generic
 * `invalid_input` because rejecting disposable-email domains is a deliberate
 * product friction whose signup cost was previously invisible. Bot-defense
 * trips are NOT counted here — they have their own bot-defense stream. The
 * per-IP rate-limit (429) short-circuits in middleware before the handler, so
 * it is likewise out of scope for this event.
 */
export const SIGNUP_OUTCOMES = {
	created: "created",
	disposableEmail: "disposable_email",
	invalidInput: "invalid_input",
	duplicateEmail: "duplicate_email",
} as const;

export type SignupOutcome = (typeof SIGNUP_OUTCOMES)[keyof typeof SIGNUP_OUTCOMES];

/**
 * Dimensions of the `view_save_intent` event. Each is the single source of
 * truth shared by emitters (the save surfaces) and the dashboard widgets that
 * slice the save funnel, so a value rename surfaces as a TypeScript error at
 * every call site rather than silently splitting a metric in two.
 */
export const SAVE_SURFACES = {
	readerView: "reader_view",
	queueSaveBar: "queue_save_bar",
	extension: "extension",
} as const;

export const SAVE_OUTCOMES = {
	saved: "saved",
	promptedToSignUp: "prompted_to_sign_up",
	error: "error",
} as const;

export const CONTENT_CLASSES = {
	own: "own",
	thirdParty: "third_party",
} as const;

export type SaveSurface = (typeof SAVE_SURFACES)[keyof typeof SAVE_SURFACES];
export type SaveOutcome = (typeof SAVE_OUTCOMES)[keyof typeof SAVE_OUTCOMES];

/**
 * `utm_medium` value stamped on every in-site link and action button so a click
 * can be counted without an extra request or a client-side beacon. The analytics
 * middleware emits a `click` event for any request carrying it (GET, HTMX-boosted,
 * or POST) and keeps it out of `pageview` so acquisition dashboards — which group
 * by the real `utm_source` (hackernews, newsletter, …) — are not diluted by
 * internal navigation. Imported by both the link-tagging helper (producer) and
 * the analytics middleware (consumer) so the two never drift.
 */
export const INTERNAL_CLICK_MEDIUM = "internal";
