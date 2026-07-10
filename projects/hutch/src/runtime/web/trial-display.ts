import { deriveTrialEscalation, formatTrialRemaining } from "@packages/web-shell";
import type { TrialDisplay } from "@packages/web-shell";
import type { EffectiveAccess } from "@packages/subscription-access";

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
		case "cancellation-scheduled":
			return {
				state: "cancellation-scheduled",
				endsAtIso: access.cancellationEffectiveAt,
				serverNowIso: now.toISOString(),
			};
		case "inactive":
			return { state: "expired" };
		case "none":
			return undefined;
	}
}
