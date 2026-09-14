import { render } from "./render";
import { buildNavGroups, buildGuestNavItems, type NavGroup, type NavItem } from "./banner-state";
import { type ClickSurface, withClickSurface } from "./internal-link-tracking";
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
	gmailFeatureEnabled: boolean;
	/** Absence means the user is not on a trial — no countdown rendered.
	 * Pre-auth pages (login, signup, forgot-password) build banner state from
	 * the request synchronously and never populate this field, which is correct:
	 * those requests have no userId, so the async builder would also short-circuit
	 * to undefined. */
	trialCounter?: TrialDisplay;
	clickSurface?: ClickSurface;
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

function itemOnSurface(item: NavItem, surface: ClickSurface | undefined): NavItem {
	return { ...item, href: withClickSurface(item.href, surface), trackTerm: surface };
}

function groupsOnSurface(groups: NavGroup[], surface: ClickSurface | undefined): NavGroup[] {
	return groups.map((group) => ({ ...group, items: group.items.map((item) => itemOnSurface(item, surface)) }));
}

export function GlobalNav(props: NavProps): string {
	const trial = props.trialCounter;
	const surface = props.clickSurface;
	return render(NAV_TEMPLATE, {
		transparent: props.variant === "transparent",
		clickSurface: surface,
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
			? groupsOnSurface(
					buildNavGroups({
						accessIsReadOnly: props.accessIsReadOnly,
						gmailFeatureEnabled: props.gmailFeatureEnabled,
					}),
					surface,
				)
			: undefined,
		navItems: props.isAuthenticated
			? undefined
			: buildGuestNavItems().map((item) => itemOnSurface(item, surface)),
		navVariant: props.isAuthenticated ? "authenticated" : "guest",
	});
}
