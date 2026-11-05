import type { BillingPlan } from "@packages/provider-contracts/subscription-providers";
import type { EffectiveAccess } from "@packages/subscription-access";
import { type NeedsUpgradeControl, renderNeedsUpgrade, withInternalTracking } from "@packages/web-shell";
import type { Request } from "express";

import { isNativeSurface } from "../../onboarding/native-client";
import { ACCOUNT_PLANS_URL } from "../../pages/account/account.url";
import {
	SUBSCRIBE_PLANS_POPOVER_ID,
	planChargedWithoutChoice,
} from "../subscribe-plans/subscribe-plans.component";

export interface UpgradeOffer {
	popoverId: string;
	plansPath: string;
	checkedPlan: BillingPlan;
}

export type UpgradeStanding = "open" | "needs-upgrade" | "withheld";

export const TIER_CAN_UPGRADE = {
	founding: false,
	paid: false,
	trial: true,
	inactive: true,
} satisfies Record<EffectiveAccess["tier"], boolean>;

export function upgradeOfferFor(input: {
	req: Pick<Request, "query" | "get">;
	access: EffectiveAccess;
}): UpgradeOffer | undefined {
	if (isNativeSurface(input.req) || !TIER_CAN_UPGRADE[input.access.tier]) return undefined;
	return {
		popoverId: SUBSCRIBE_PLANS_POPOVER_ID,
		plansPath: ACCOUNT_PLANS_URL,
		checkedPlan: planChargedWithoutChoice(input.access),
	};
}

export function standingOf(input: { gated: boolean; offer: UpgradeOffer | undefined }): UpgradeStanding {
	if (!input.gated) return "open";
	return input.offer === undefined ? "withheld" : "needs-upgrade";
}

export function lockFor(input: {
	offer: UpgradeOffer | undefined;
	gated: boolean;
	key: string;
	label: string;
	controlClass: string;
	source: string;
}): NeedsUpgradeControl | undefined {
	const { offer } = input;
	if (offer === undefined || !input.gated) return undefined;
	return {
		key: input.key,
		label: input.label,
		controlClass: input.controlClass,
		popoverId: offer.popoverId,
		fallbackHref: withInternalTracking(offer.plansPath, {
			source: input.source,
			content: `upgrade-${input.key}`,
		}),
	};
}

export function renderedLockFor(input: Parameters<typeof lockFor>[0]): readonly string[] {
	const lock = lockFor(input);
	return lock === undefined ? [] : [renderNeedsUpgrade(lock)];
}
