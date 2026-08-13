import type { AuthenticatedUserId } from "@packages/domain/user";
import { deriveTrialEscalation, formatTrialRemaining } from "@packages/web-shell";
import type { GetEffectiveAccess } from "@packages/subscription-access";

/**
 * Whether the MCP surface is open to an authenticated caller.
 *
 * The decision is not re-derived here — it reuses `getEffectiveAccess` (the same
 * resolver the web banner reads) and the trial-countdown escalation buckets, so
 * "lapsed" and "trial nearly over" mean exactly what they mean on the web. The
 * caller (`mcp-server`) owns the envelope: it returns `message` as a tool error
 * when an inactive caller tries to save (every other tool stays open), and
 * appends `nudge` as a second text block to a successful result when the trial
 * is ending.
 */

/** Hard-coded production URL for the account page where a renewal is completed. */
const APP_ACCOUNT_URL = "https://readplace.com/account";

const INACTIVE_MESSAGE =
	"Saving new links is paused because this Readplace subscription isn't active. " +
	`Everything already saved stays readable and exportable, and the subscription can be reactivated at ${APP_ACCOUNT_URL}.`;

/** Appended to a successful result while a trial is in its final week (the
 * escalation buckets past "soft", i.e. seven days or fewer remaining). */
const TRIAL_ENDING_NUDGE = `This Readplace free trial ends soon; the subscription can be managed at ${APP_ACCOUNT_URL}.`;

export type ToolAccess =
	| { readonly state: "ok" }
	| { readonly state: "trial-ending"; readonly nudge: string }
	| { readonly state: "inactive"; readonly message: string };

export function initResolveToolAccess(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	now: () => Date;
}): (userId: AuthenticatedUserId) => Promise<ToolAccess> {
	return async (userId) => {
		const access = await deps.getEffectiveAccess(userId);
		if (access.access === "read-only") {
			return { state: "inactive", message: INACTIVE_MESSAGE };
		}
		if (access.banner === "trial-countdown") {
			const remaining = formatTrialRemaining(access.trialEndsAt, deps.now());
			if (deriveTrialEscalation(remaining) !== "soft") {
				return { state: "trial-ending", nudge: TRIAL_ENDING_NUDGE };
			}
		}
		return { state: "ok" };
	};
}
