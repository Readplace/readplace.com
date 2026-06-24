import type { AuthenticatedUserId } from "@packages/domain/user";
import {
	ANNUAL_PRICE_DISPLAY,
	deriveTrialEscalation,
	formatTrialRemaining,
} from "@packages/web-shell";
import type { GetEffectiveAccess } from "../../domain/access/effective-access";

/**
 * Whether the MCP surface is open to an authenticated caller right now, and how
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
 * when an inactive caller tries to save (the read tools stay open), and appends
 * `nudge` as a second text block to a successful result when the trial is ending.
 */

/** The account page where a renewal is completed. Hard-coded prod URL, mirroring
 * `APP_QUEUE_URL` in mcp-server.ts; co-located with the copy that embeds it. */
const APP_ACCOUNT_URL = "https://readplace.com/account";

/** Shown when a read-only subscription tries to save a new link; the read tools
 * stay open, so the copy pauses only saving. The voice mirrors the
 * checkout-recovery email — a coffee a month, no investor money, each
 * subscription keeps Readplace running another year. */
const INACTIVE_UPSELL =
	"Your Readplace subscription isn't active, so saving new links is paused — you can still read and export everything already in your queue. " +
	`Readplace is ${ANNUAL_PRICE_DISPLAY}/year — about a coffee a month — and it's what pays for the AI summary on every link you save. ` +
	"There's no investor money behind it; each subscription keeps Readplace running another year. " +
	`Reactivate in a minute at ${APP_ACCOUNT_URL} — your queue is right where you left it.`;

/** Appended to a successful result while a trial is in its final week (the
 * escalation buckets past "soft", i.e. seven days or fewer remaining). */
const TRIAL_ENDING_NUDGE =
	`PS — your Readplace free trial ends soon. Keep your queue and AI summaries going for ${ANNUAL_PRICE_DISPLAY}/year (about a coffee a month) at ${APP_ACCOUNT_URL}.`;

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
