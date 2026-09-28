import { UserIdSchema } from "@packages/domain/user";
import { FETCH_CHANGELOG_BANNER_IN_BROWSER, bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource } from "@packages/web-shell";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "@packages/subscription-access";
import type { FindUserById } from "@packages/provider-contracts/auth";

export type BuildBannerState = (
	source: BannerStateSource,
	options?: { preFetchedAccess?: EffectiveAccess },
) => Promise<BannerState>;

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	findUserById: FindUserById;
}): BuildBannerState {
	return async (source, options) => {
		const withBanner: BannerState = {
			...bannerStateFromRequest(source),
			changelogBanner: FETCH_CHANGELOG_BANNER_IN_BROWSER,
		};
		if (!source.userId) return withBanner;
		const userId = UserIdSchema.parse(source.userId);
		const [access, user] = await Promise.all([
			options?.preFetchedAccess ?? deps.getEffectiveAccess(userId),
			deps.findUserById(userId),
		]);
		return {
			...withBanner,
			accessIsReadOnly: access.access === "read-only",
			appearance: user?.appearance,
			...(user ? { userEmail: user.email } : {}),
		};
	};
}
