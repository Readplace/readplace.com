import { UserIdSchema } from "@packages/domain/user";
import { bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource } from "@packages/web-shell";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "@packages/subscription-access";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type { GetChangelogBanner } from "./changelog-banner-source";
import { toTrialDisplay } from "./trial-display";

export type BuildBannerState = (
	source: BannerStateSource,
	options?: { preFetchedAccess?: EffectiveAccess },
) => Promise<BannerState>;

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	getChangelogBanner: GetChangelogBanner;
	findUserById: FindUserById;
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
		if (!source.userId) return withBanner;
		const userId = UserIdSchema.parse(source.userId);
		const [access, user] = await Promise.all([
			options?.preFetchedAccess ?? deps.getEffectiveAccess(userId),
			deps.findUserById(userId),
		]);
		const trial = toTrialDisplay(access, deps.now());
		const accessIsReadOnly = access.access === "read-only";
		return {
			...withBanner,
			accessIsReadOnly,
			...(user ? { userEmail: user.email } : {}),
			...(trial ? { trial } : {}),
		};
	};
}
