import type { AuthenticatedUserId } from "@packages/domain/user";
import {
	deriveTrialEscalation,
	formatTrialRemaining,
	MONTHLY_EQUIVALENT_DISPLAY,
} from "@packages/web-shell";
import type { GetEffectiveAccess } from "@packages/subscription-access";

/**
 * Whether the MCP surface is open to an authenticated caller, and how
 * to monetise the moment if it isn't. This is the renewal experience the flat
 * `save_link` refusal lacked: a read-only (lapsed) subscription gets a renewal
 * upsell carrying the `/account` link instead of a bare "not active", and a
 * trial in its final week gets a gentle convert-to-annual nudge on successful
 * results.
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

const INACTIVE_UPSELL =
	"Your Readplace subscription isn't active, so saving new links is paused — you can still read and export everything already in your queue. " +
	`Readplace is ${MONTHLY_EQUIVALENT_DISPLAY}/month — about the price of a coffee — and it's what pays for the computing and features usage on every link you save. ` +
	"There's no investor money behind it; each subscription keeps Readplace running another year. " +
	`Reactivate in a minute at ${APP_ACCOUNT_URL} — your queue is right where you left it.`;

/** Appended to a successful result while a trial is in its final week (the
 * escalation buckets past "soft", i.e. seven days or fewer remaining). */
const TRIAL_ENDING_NUDGE =
	`PS — your Readplace free trial ends soon. Keep your queue and AI summaries going for ${MONTHLY_EQUIVALENT_DISPLAY}/month (about the price of a coffee) at ${APP_ACCOUNT_URL}.`;

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
			return { state: "inactive", message: INACTIVE_UPSELL };
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
