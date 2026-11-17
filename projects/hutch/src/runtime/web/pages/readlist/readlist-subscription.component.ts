import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type LocalTime, PRICING_PLANS, UPGRADE_CTA_LABEL, render } from "@packages/web-shell";

import { PRICE_STATEMENT, RENEWAL_PRICES, SAVES_STAY_STATEMENT } from "../../price-statement";
import type { UpgradeOffer } from "../../shared/upgrade-offer/upgrade-offer";
import type { SubscriptionBannerState } from "./readlist.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "readlist-subscription.template.html"), "utf-8");

interface TrialTile {
	unit: "days" | "hours" | "minutes";
	label: string;
	value: string;
}

interface UpgradeCta {
	popoverId: string;
	label: string;
}

export interface ReadlistSubscriptionDisplayModel {
	stateClass: string;
	isTrialStatus: boolean;
	isTrialCountdown: boolean;
	isCancellationScheduled: boolean;
	isInactive: boolean;
	tiles: readonly TrialTile[];
	trialDaysLeft?: number;
	trialDaysLeftWord?: string;
	cancellationEffectiveAt?: LocalTime;
	upgradeCtas: readonly UpgradeCta[];
	priceStatement: string;
	renewalPrices: string;
	savesStayStatement: string;
	yearlyPrice: string;
	monthlyPrice: string;
}

function upgradeCtasOf(offer: UpgradeOffer | undefined): UpgradeCta[] {
	return offer === undefined ? [] : [{ popoverId: offer.popoverId, label: UPGRADE_CTA_LABEL }];
}

function trialTiles(remaining: { days: number; hours: number; minutes: number }): TrialTile[] {
	return [
		{ unit: "days", label: "Days", value: String(remaining.days) },
		{ unit: "hours", label: "Hours", value: String(remaining.hours) },
		{ unit: "minutes", label: "Minutes", value: String(remaining.minutes) },
	];
}

export function toReadlistSubscriptionDisplayModel(
	banner: SubscriptionBannerState,
): ReadlistSubscriptionDisplayModel {
	const shared = {
		stateClass: `readlist-subscription--${banner.state}`,
		isTrialStatus: banner.state === "trial-status",
		isTrialCountdown: banner.state === "trial-countdown",
		isCancellationScheduled: banner.state === "cancellation-scheduled",
		isInactive: banner.state === "inactive",
		priceStatement: PRICE_STATEMENT,
		renewalPrices: RENEWAL_PRICES,
		savesStayStatement: SAVES_STAY_STATEMENT,
		yearlyPrice: PRICING_PLANS.yearly.totalDisplay,
		monthlyPrice: PRICING_PLANS.monthly.totalDisplay,
	};
	switch (banner.state) {
		case "trial-status":
			return {
				...shared,
				upgradeCtas: [],
				tiles: [],
				trialDaysLeft: banner.daysLeft,
				trialDaysLeftWord: banner.daysLeftWord,
			};
		case "trial-countdown":
			return {
				...shared,
				upgradeCtas: upgradeCtasOf(banner.upgradeOffer),
				tiles: trialTiles(banner.remaining),
				trialDaysLeft: banner.daysLeft,
				trialDaysLeftWord: banner.daysLeftWord,
			};
		case "cancellation-scheduled":
			return { ...shared, upgradeCtas: [], tiles: [], cancellationEffectiveAt: banner.cancellationEffectiveAt };
		case "inactive":
			return { ...shared, upgradeCtas: upgradeCtasOf(banner.upgradeOffer), tiles: [] };
		case "none":
			return { ...shared, upgradeCtas: [], tiles: [] };
	}
}

export function renderReadlistSubscription(
	displayModel: ReadlistSubscriptionDisplayModel,
): string {
	return render(TEMPLATE, displayModel);
}
