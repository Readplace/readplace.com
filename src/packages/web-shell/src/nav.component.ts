import { render } from "./render";
import { buildNavGroups, buildGuestNavItems } from "./banner-state";
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

export function GlobalNav(props: NavProps): string {
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
			? buildNavGroups({ accessIsReadOnly: props.accessIsReadOnly })
			: undefined,
		navItems: props.isAuthenticated ? undefined : buildGuestNavItems(),
		navVariant: props.isAuthenticated ? "authenticated" : "guest",
	});
}
