import type { UserId } from "@packages/domain/user";
import { bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource } from "@packages/web-shell";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "../domain/access/effective-access";
import type { GetChangelogBanner } from "./changelog-banner-source";
import { toTrialDisplay } from "./trial-display";

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
		const banner = await deps.getChangelogBanner();
		// Suppress the banner the reader has already dismissed (cookie version,
		// lifted onto the source by the dismiss middleware). Folded in before the
		// guest early-return so guests see it too.
		const changelogBanner =
			banner && banner.version !== source.dismissedChangelogVersion ? banner : undefined;
		const withBanner: BannerState = changelogBanner ? { ...base, changelogBanner } : base;
		const userId: UserId | undefined = source.userId;
		if (!userId) return withBanner;
		const access =
			options?.preFetchedAccess ?? (await deps.getEffectiveAccess(userId));
		const trial = toTrialDisplay(access, deps.now());
		const accessIsReadOnly = access.access === "read-only";
		return { ...withBanner, accessIsReadOnly, ...(trial ? { trial } : {}) };
	};
}
