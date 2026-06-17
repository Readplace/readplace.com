import type { UserId } from "@packages/domain/user";
import { bannerStateFromRequest } from "@packages/web-shell";
import type { BannerState, BannerStateSource } from "@packages/web-shell";
import type {
	EffectiveAccess,
	GetEffectiveAccess,
} from "../domain/access/effective-access";
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
	now: () => Date;
	offerPaymentLink: string;
}): BuildBannerState {
	return async (source, options) => {
		const base = bannerStateFromRequest(source);
		const userId: UserId | undefined = source.userId;
		if (!userId) return base;
		const access =
			options?.preFetchedAccess ?? (await deps.getEffectiveAccess(userId));
		const trial = toTrialDisplay(access, deps.now());
		const accessIsReadOnly = access.access === "read-only";
		const offerPopup = isOfferPopupEligible(access, deps.now())
			? {
					html: renderOfferPopup(deps.offerPaymentLink),
					styles: OFFER_POPUP_STYLES,
					script: OFFER_POPUP_SCRIPT,
				}
			: undefined;
		return {
			...base,
			accessIsReadOnly,
			...(trial ? { trial } : {}),
			...(offerPopup ? { offerPopup } : {}),
		};
	};
}
