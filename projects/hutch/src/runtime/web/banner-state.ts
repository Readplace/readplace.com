import type { UserId } from "@packages/domain/user";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "../domain/access/effective-access";
import { toTrialDisplay, type TrialDisplay } from "./trial-countdown.format";

export interface BannerStateSource {
	userId?: UserId;
	emailVerified?: boolean;
	query?: Record<string, unknown>;
}

export type NavItemKey =
	| "queue"
	| "import"
	| "export"
	| "account"
	| "logout"
	| "features"
	| "signup";

/** Data-driven header nav item. Rendered uniformly as
 * `<form method="{method}" action="{href}"><button>{label}</button></form>`
 * regardless of method — the template never branches on link-vs-form. A
 * `method="GET"` form with no inputs navigates to the action URL on submit
 * (the browser appends `?` and follows), so it behaves exactly like a
 * link; using forms everywhere keeps a single template shape and a single
 * styling target (`.nav__link` already styles `button.nav__link`).
 * Excessive markup is not a performance concern at this scale. */
export interface NavItem {
	key: NavItemKey;
	label: string;
	href: string;
	method: "GET" | "POST";
}

export interface BannerState {
	isAuthenticated: boolean;
	emailVerified: boolean | undefined;
	/** When true, the SSR markup carries data-show-extension-suggestion="true"
	 * so the banner client can reveal the dismissible extension-suggestion banner
	 * (subject to its own localStorage dismissal). Defaults to false; the queue
	 * and view page handlers set it when the latest article is not fully parsed. */
	showExtensionSuggestionBanner?: boolean;
	/** Switches the banner copy: when true the message tells the reader to re-save
	 * the article with their already-installed extension; when false (or unset) it
	 * pitches the install. Sourced from the extension liveness cookie. */
	extensionInstalled?: boolean;
	/** Drives the global trial countdown rendered below the brand in the header.
	 * Undefined for guests, founding members, paid users, and users with a
	 * pending cancellation; "active" for trialing users; "expired" for users
	 * whose trial has lapsed or whose subscription was cancelled. */
	trial?: TrialDisplay;
	/** Single feature toggle (?feature=subscription) gating subscription-aware UI:
	 * the /account menu entry in the header, and the queue-page banner aside
	 * that surfaces either the trial countdown or the "subscription not active"
	 * message. */
	showSubscription?: boolean;
	/** True when the user's effective access is read-only (trial-expired or
	 * subscription-cancelled). Drives nav-item visibility: import (save flow
	 * is gated server-side) and account (the trial-countdown link in the
	 * header already routes there) are hidden for read-only users. Undefined
	 * for guests and for pages that build the banner state synchronously
	 * (without an access lookup); `buildNavItems` treats undefined as full
	 * access. */
	accessIsReadOnly?: boolean;
}

const NAV_QUEUE: NavItem = { key: "queue", label: "Queue", href: "/queue", method: "GET" };
const NAV_IMPORT: NavItem = {
	key: "import",
	label: "Import Links",
	href: "/import?utm_source=header-nav&utm_medium=internal&utm_content=import-link",
	method: "GET",
};
const NAV_EXPORT: NavItem = { key: "export", label: "Export", href: "/export", method: "GET" };
const NAV_ACCOUNT: NavItem = {
	key: "account",
	label: "Account",
	href: "/account?feature=subscription",
	method: "GET",
};
const NAV_LOGOUT: NavItem = { key: "logout", label: "Sign out", href: "/logout", method: "POST" };
const NAV_FEATURES: NavItem = {
	key: "features",
	label: "Features",
	href: "/#what-works",
	method: "GET",
};
const NAV_SIGNUP: NavItem = { key: "signup", label: "Sign up", href: "/signup", method: "GET" };

/** Builds the header nav-items array from the per-request boolean flags.
 * The template iterates this list — no inline conditionals. Adding a new
 * nav item means editing this function, not editing the template. */
export function buildNavItems(input: {
	isAuthenticated: boolean;
	accessIsReadOnly: boolean;
	showSubscription: boolean;
}): NavItem[] {
	if (!input.isAuthenticated) {
		return [NAV_FEATURES, NAV_SIGNUP];
	}
	const items: NavItem[] = [NAV_QUEUE];
	if (!input.accessIsReadOnly) {
		items.push(NAV_IMPORT);
	}
	items.push(NAV_EXPORT);
	if (input.showSubscription && !input.accessIsReadOnly) {
		items.push(NAV_ACCOUNT);
	}
	items.push(NAV_LOGOUT);
	return items;
}

export function bannerStateFromRequest(source: BannerStateSource): BannerState {
	return {
		isAuthenticated: Boolean(source.userId),
		emailVerified: source.emailVerified,
		showSubscription: source.query?.feature === "subscription",
	};
}

export type BuildBannerState = (
	source: BannerStateSource,
	options?: { preFetchedAccess?: EffectiveAccess },
) => Promise<BannerState>;

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	now: () => Date;
}): BuildBannerState {
	return async (source, options) => {
		const base = bannerStateFromRequest(source);
		const userId: UserId | undefined = source.userId;
		if (!userId) return base;
		const access =
			options?.preFetchedAccess ?? (await deps.getEffectiveAccess(userId));
		const trial = toTrialDisplay(access, deps.now());
		const accessIsReadOnly = access.access === "read-only";
		return { ...base, accessIsReadOnly, ...(trial ? { trial } : {}) };
	};
}
