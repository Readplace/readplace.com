import { UserIdSchema } from "@packages/domain/user";
import { CONFIRM_POPOVER_STYLES, FETCH_CHANGELOG_BANNER_IN_BROWSER, bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource } from "@packages/web-shell";
import type { FindUserById, FindUserByIdResult } from "@packages/provider-contracts/auth";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "@packages/subscription-access";
import type { Request } from "express";
import {
	SUBSCRIBE_PLANS_STYLES,
	type SubscribePlansSource,
	renderSubscribePlansPopover,
} from "./shared/subscribe-plans/subscribe-plans.component";
import { type UpgradeOffer, upgradeOfferFor } from "./shared/upgrade-offer/upgrade-offer";

export type BuildBannerState = (
	source: BannerStateSource & Pick<Request, "query" | "get">,
	options?: {
		preFetchedAccess?: EffectiveAccess;
		preFetchedUser?: FindUserByIdResult;
		upgradeSource?: SubscribePlansSource;
	},
) => Promise<BannerState>;

function upgradeFieldsOf(input: {
	offer: UpgradeOffer | undefined;
	source: SubscribePlansSource;
}): Pick<BannerState, "upgrade" | "siteDialog"> {
	const { offer } = input;
	if (offer === undefined) return {};
	return {
		upgrade: { popoverId: offer.popoverId, plansPath: offer.plansPath },
		siteDialog: {
			html: renderSubscribePlansPopover({ source: input.source, checkedPlan: offer.checkedPlan }),
			styles: CONFIRM_POPOVER_STYLES + SUBSCRIBE_PLANS_STYLES,
		},
	};
}

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	findUserById: FindUserById;
}): BuildBannerState {
	return async (source, options) => {
		// Folded in before the guest early-return so guests see it too.
		const withBanner: BannerState = {
			...bannerStateFromRequest(source),
			changelogBanner: FETCH_CHANGELOG_BANNER_IN_BROWSER,
		};
		if (!source.userId) return withBanner;
		const userId = UserIdSchema.parse(source.userId);
		const [access, user] = await Promise.all([
			options?.preFetchedAccess ?? deps.getEffectiveAccess(userId),
			options?.preFetchedUser ?? deps.findUserById(userId),
		]);
		return {
			...withBanner,
			...upgradeFieldsOf({
				offer: upgradeOfferFor({ req: source, access }),
				source: options?.upgradeSource ?? "header-nav",
			}),
			accessIsReadOnly: access.access === "read-only",
			appearance: user?.appearance,
			signedInUser: user ? { email: user.email, displayName: user.displayName } : undefined,
		};
	};
}
