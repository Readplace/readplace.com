import { UserIdSchema } from "@packages/domain/user";
import { bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource, ChangelogBanner } from "@packages/web-shell";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "@packages/subscription-access";
import type { GetChangelogBanner } from "./changelog-banner-source";
import { toTrialDisplay } from "./trial-display";

/** The single rule deciding whether a fetched announcement is shown to this
 * reader: suppress the exact version they already dismissed (the cookie value,
 * lifted onto the request by the dismiss middleware). Both shells call this — the
 * full web shell via `buildBannerState`, the chromeless iOS reader directly — so
 * the two cannot drift into disagreeing about what "dismissed" means, and a
 * dismissal in either surface silences the other. */
export function selectChangelogBanner(
	banner: ChangelogBanner | undefined,
	dismissedVersion: string | undefined,
): ChangelogBanner | undefined {
	return banner && banner.version !== dismissedVersion ? banner : undefined;
}

export type BuildBannerState = (
	source: BannerStateSource,
	options?: { preFetchedAccess?: EffectiveAccess },
) => Promise<BannerState>;

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	getChangelogBanner: GetChangelogBanner;
	now: () => Date;
}): BuildBannerState {
	return async (source, options) => {
		const base = bannerStateFromRequest(source);
		// Folded in before the guest early-return so guests see it too.
		const changelogBanner = selectChangelogBanner(
			await deps.getChangelogBanner(),
			source.dismissedChangelogVersion,
		);
		const withBanner: BannerState = changelogBanner ? { ...base, changelogBanner } : base;
		if (!source.userId) return withBanner;
		const userId = UserIdSchema.parse(source.userId);
		const access =
			options?.preFetchedAccess ?? (await deps.getEffectiveAccess(userId));
		const trial = toTrialDisplay(access, deps.now());
		const accessIsReadOnly = access.access === "read-only";
		return { ...withBanner, accessIsReadOnly, ...(trial ? { trial } : {}) };
	};
}
