import type { EffectiveAccess } from "../domain/access/effective-access";

export interface TrialRemaining {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
	totalMs: number;
}

export type TrialEscalation = "soft" | "moderate" | "urgent" | "critical";

export type TrialDisplay =
	| {
			state: "active";
			endsAtIso: string;
			serverNowIso: string;
			remaining: TrialRemaining;
			escalation: TrialEscalation;
		}
	| { state: "expired" };

const ONE_SECOND_MS = 1000;
const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS;

export function formatTrialRemaining(
	endsAtIso: string,
	now: Date,
): TrialRemaining {
	const endsAtMs = Date.parse(endsAtIso);
	const totalMs = Math.max(0, endsAtMs - now.getTime());
	const days = Math.floor(totalMs / ONE_DAY_MS);
	const hours = Math.floor((totalMs % ONE_DAY_MS) / ONE_HOUR_MS);
	const minutes = Math.floor((totalMs % ONE_HOUR_MS) / ONE_MINUTE_MS);
	const seconds = Math.floor((totalMs % ONE_MINUTE_MS) / ONE_SECOND_MS);
	return { days, hours, minutes, seconds, totalMs };
}

export function deriveTrialEscalation(
	remaining: TrialRemaining,
): TrialEscalation {
	if (remaining.totalMs > SEVEN_DAYS_MS) return "soft";
	if (remaining.totalMs > ONE_DAY_MS) return "moderate";
	if (remaining.totalMs > ONE_HOUR_MS) return "urgent";
	return "critical";
}

export function formatTrialDisplay(trial: TrialDisplay): string {
	/** Same copy for trial-expired and post-cancellation: both land users in
	 * the same read-only state, so a unified "Subscription not active"
	 * message matches what the account card says and avoids surfacing the
	 * trial mechanic to users who never had one. */
	if (trial.state === "expired") return "Subscription not active";
	return `${formatTrialUnits(trial.remaining)} left in your free trial`;
}

function formatTrialUnits(remaining: TrialRemaining): string {
	const { days, hours, minutes, seconds } = remaining;
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function toTrialDisplay(
	access: EffectiveAccess,
	now: Date,
): TrialDisplay | undefined {
	switch (access.banner) {
		case "trial-countdown": {
			const remaining = formatTrialRemaining(access.trialEndsAt, now);
			return {
				state: "active",
				endsAtIso: access.trialEndsAt,
				serverNowIso: now.toISOString(),
				remaining,
				escalation: deriveTrialEscalation(remaining),
			};
		}
		case "inactive":
			return { state: "expired" };
		case "none":
			return undefined;
	}
}
