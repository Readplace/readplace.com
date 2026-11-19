import { type GetEffectiveAccess, isDailyLimited, type EffectiveAccess } from "@packages/subscription-access";
import type { ChargeOcrPages } from "@packages/crawl-article";
import type { ChargeOcrPagesFor } from "./dynamodb-ocr-page-quota";

const chargeNothing: ChargeOcrPages = async () => ({ allowed: true });

export function selectOcrCharger(params: { access: EffectiveAccess; quota: ChargeOcrPages }): ChargeOcrPages {
	return isDailyLimited(params.access) ? params.quota : chargeNothing;
}

export function initChargeOcrPagesForAccount(deps: {
	getEffectiveAccess: GetEffectiveAccess;
	quota: ChargeOcrPagesFor;
}): ChargeOcrPagesFor {
	return ({ userId, claimId }) => async ({ pages }) => {
		const access = await deps.getEffectiveAccess(userId);
		return selectOcrCharger({ access, quota: deps.quota({ userId, claimId }) })({ pages });
	};
}
