import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "./render";
import { buildNavItems } from "./banner-state";
import { formatTrialDisplay, type TrialDisplay } from "./trial-countdown.format";

const NAV_TEMPLATE = readFileSync(join(__dirname, "nav.template.html"), "utf-8");

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
	return "expired";
}

export function Nav(props: NavProps): string {
	const trial = props.trialCounter;
	const navItems = buildNavItems({
		isAuthenticated: props.isAuthenticated,
		accessIsReadOnly: props.accessIsReadOnly,
	});
	return render(NAV_TEMPLATE, {
		transparent: props.variant === "transparent",
		trial: Boolean(trial),
		trialDisplayText: trial ? formatTrialDisplay(trial) : "",
		trialState: trial?.state ?? "",
		trialEscalationClass: escalationClassFor(trial),
		trialEndsAtIso: endsAtIsoFor(trial),
		serverNowIso: serverNowIsoFor(trial),
		navItems,
		navVariant: props.isAuthenticated ? "authenticated" : "guest",
	});
}
