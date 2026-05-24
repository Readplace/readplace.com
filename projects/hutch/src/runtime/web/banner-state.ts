import type { UserId } from "@packages/domain/user";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "../domain/access/effective-access";
import { toTrialDisplay, type TrialDisplay } from "./trial-countdown.format";

export interface BannerStateSource {
	userId?: UserId;
	emailVerified?: boolean;
	query?: Record<string, unknown>;
}

export interface BannerState {
	isAuthenticated: boolean;
	emailVerified: boolean | undefined;
	/** When true, the SSR markup carries data-show-extension-suggestion="true"
	 * so the banner client can reveal the dismissible extension-suggestion banner
	 * (subject to its own localStorage dismissal). Defaults to false; the queue
	 * and view page handlers set it when the latest article is not fully parsed. */
	showExtensionSuggestionBanner?: boolean;
	/** Switches the banner copy: when true the message tells the reader to re-save
	 * the article with their already-installed extension; when false (or unset) it
	 * pitches the install. Sourced from the extension liveness cookie. */
	extensionInstalled?: boolean;
	/** Drives the global trial countdown rendered below the brand in the header.
	 * Undefined for guests, founding members, paid users, and users with a
	 * pending cancellation; "active" for trialing users; "expired" for users
	 * whose trial has lapsed or whose subscription was cancelled. */
	trial?: TrialDisplay;
	/** Single feature toggle (?feature=subscription) gating subscription-aware UI:
	 * the /account menu entry in the header, and the queue-page banner aside
	 * that surfaces either the trial countdown or the "subscription not active"
	 * message. */
	showSubscription?: boolean;
}

export function bannerStateFromRequest(source: BannerStateSource): BannerState {
	return {
		isAuthenticated: Boolean(source.userId),
		emailVerified: source.emailVerified,
		showSubscription: source.query?.feature === "subscription",
	};
}

export type BuildBannerState = (
	source: BannerStateSource,
	options?: { preFetchedAccess?: EffectiveAccess },
) => Promise<BannerState>;

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	now: () => Date;
}): BuildBannerState {
	return async (source, options) => {
		const base = bannerStateFromRequest(source);
		const userId: UserId | undefined = source.userId;
		if (!userId) return base;
		const access =
			options?.preFetchedAccess ?? (await deps.getEffectiveAccess(userId));
		const trial = toTrialDisplay(access, deps.now());
		if (!trial) return base;
		return { ...base, trial };
	};
}
