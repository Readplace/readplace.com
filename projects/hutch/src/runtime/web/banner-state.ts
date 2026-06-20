import { UserIdSchema } from "@packages/domain/user";
import { bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource } from "@packages/web-shell";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "../domain/access/effective-access";
import type { GetChangelogBanner } from "./changelog-banner-source";
import { isOfferPopupEligible } from "../domain/access/offer-popup-eligibility";
import {
	OFFER_POPUP_SCRIPT,
	renderOfferPopup,
} from "./shared/offer-popup/offer-popup.component";
import { OFFER_POPUP_STYLES } from "./shared/offer-popup/offer-popup.styles";
import { toTrialDisplay } from "./trial-display";

export type BuildBannerState = (
	source: BannerStateSource,
	options?: { preFetchedAccess?: EffectiveAccess },
) => Promise<BannerState>;

export function initBuildBannerState(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	getChangelogBanner: GetChangelogBanner;
	now: () => Date;
	offerPaymentLink: string;
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
		const access =
			options?.preFetchedAccess ?? (await deps.getEffectiveAccess(userId));
		const now = deps.now();
		const trial = toTrialDisplay(access, now);
		const accessIsReadOnly = access.access === "read-only";
		const offerPopup = isOfferPopupEligible(access, now)
			? {
					html: renderOfferPopup(deps.offerPaymentLink),
					styles: OFFER_POPUP_STYLES,
					script: OFFER_POPUP_SCRIPT,
				}
			: undefined;
		return {
			...withBanner,
			accessIsReadOnly,
			...(trial ? { trial } : {}),
			...(offerPopup ? { offerPopup } : {}),
		};
	};
}
