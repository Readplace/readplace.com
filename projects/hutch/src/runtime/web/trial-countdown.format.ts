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
	if (trial.state === "expired") return "Free trial is over!";
	const { days, hours, minutes, seconds } = trial.remaining;
	return `${days}d ${hours}h ${minutes}m ${seconds}s in your free trial`;
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
		case "pending-cancellation":
			return undefined;
	}
}
