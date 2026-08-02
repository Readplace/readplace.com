import { render } from "./render";
import { buildNavGroups, buildGuestNavItems, type NavGroup, type NavItem } from "./banner-state";
import { NAV_TEMPLATE } from "./nav.template";
import { SERVER_TIME_ZONE } from "./local-time.format";
import {
	deriveTrialEscalation,
	formatCancellationEndsLabel,
	formatTrialDisplay,
	formatTrialRemaining,
	type TrialDisplay,
} from "./trial-countdown.format";

export interface NavProps {
	variant: "default" | "transparent";
	isAuthenticated: boolean;
	accessIsReadOnly: boolean;
	/** Absence means the user is not on a trial — no countdown rendered.
	 * Pre-auth pages (login, signup, forgot-password) build banner state from
	 * the request synchronously and never populate this field, which is correct:
	 * those requests have no userId, so the async builder would also short-circuit
	 * to undefined. */
	trialCounter?: TrialDisplay;
}

function endsAtIsoFor(trial: TrialDisplay | undefined): string {
	if (!trial) return "";
	if (trial.state === "expired") return "";
	return trial.endsAtIso;
}

function serverNowIsoFor(trial: TrialDisplay | undefined): string {
	if (!trial) return "";
	if (trial.state === "expired") return "";
	return trial.serverNowIso;
}

function escalationClassFor(trial: TrialDisplay | undefined): string {
	if (!trial) return "expired";
	if (trial.state === "active") return trial.escalation;
	if (trial.state === "cancellation-scheduled") {
		const remaining = formatTrialRemaining(
			trial.endsAtIso,
			new Date(trial.serverNowIso),
		);
		return deriveTrialEscalation(remaining) === "soft"
			? "cancellation-scheduled"
			: "cancellation-imminent";
	}
	return "expired";
}

/** Renders no site nav, for a shell that intentionally has none (a bare embed or
 * other minimal surface) — the Base-shell analog of the chromeless page's absent
 * nav. Injected explicitly so "no nav" is a deliberate choice, not a missing dep. */
export function GlobalEmptyNav(_props: NavProps): string {
	return "";
}

/** htmx attributes that boost a nav link: swap only <main> in place instead of a
 * full-document reload, scrolling the fresh destination's <main> to the top. */
const NAV_BOOST_ATTRS = 'hx-boost="true" hx-target="main" hx-select="main" hx-swap="outerHTML show:top"';

/** The boost attributes an item's form should carry. Only GET links boost:
 * logout is a POST that crosses the auth boundary, and the nav lives outside
 * <main>, so a boosted logout would swap <main> yet leave the authenticated nav
 * stranded until a hard reload. Empty on an unboosted surface too. */
function boostAttrsFor(item: NavItem, boost: boolean): string {
	return boost && item.method === "GET" ? NAV_BOOST_ATTRS : "";
}

function renderItems(items: NavItem[], boost: boolean) {
	return items.map((item) => ({ ...item, boostAttrs: boostAttrsFor(item, boost) }));
}

function renderGroups(groups: NavGroup[], boost: boolean) {
	return groups.map((group) => ({ ...group, items: renderItems(group.items, boost) }));
}

function renderNav(props: NavProps, boost: boolean): string {
	const trial = props.trialCounter;
	return render(NAV_TEMPLATE, {
		transparent: props.variant === "transparent",
		trialVisibility: trial ? "visible" : "hidden",
		trialDisplayText: trial ? formatTrialDisplay(trial, SERVER_TIME_ZONE) : "",
		trialState: trial?.state ?? "",
		trialAriaLabel:
			trial?.state === "cancellation-scheduled"
				? formatCancellationEndsLabel({
						endsAtIso: trial.endsAtIso,
						timeZone: SERVER_TIME_ZONE,
					})
				: "",
		trialEscalationClass: escalationClassFor(trial),
		trialEndsAtIso: endsAtIsoFor(trial),
		serverNowIso: serverNowIsoFor(trial),
		navGroups: props.isAuthenticated
			? renderGroups(buildNavGroups({ accessIsReadOnly: props.accessIsReadOnly }), boost)
			: undefined,
		navItems: props.isAuthenticated ? undefined : renderItems(buildGuestNavItems(), boost),
		navVariant: props.isAuthenticated ? "authenticated" : "guest",
	});
}

export function GlobalNav(props: NavProps): string {
	return renderNav(props, false);
}

/** GlobalNav with in-place htmx boosting on its GET links, for the authenticated
 * app surfaces (hutch, inbox) where a nav click stays in the same app so boosting
 * swaps <main> instead of reloading. The content surfaces (blog, embed) keep
 * GlobalNav, so a nav click there is a full cross-app navigation into the app. */
export function GlobalBoostedNav(props: NavProps): string {
	return renderNav(props, true);
}
