import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type LocalTime, SUBSCRIBE_CTA_LABEL, render } from "@packages/web-shell";

import { PRICE_STATEMENT, RENEWAL_PRICES, SAVES_STAY_STATEMENT } from "../../price-statement";
import { SUBSCRIBE_PLANS_POPOVER_ID } from "../../shared/subscribe-plans/subscribe-plans.component";
import type { SubscriptionBannerState } from "./readlist.viewmodel";

const TEMPLATE = readFileSync(join(__dirname, "readlist-subscription.template.html"), "utf-8");

interface TrialTile {
	unit: "days" | "hours" | "minutes";
	label: string;
	value: string;
}

export interface ReadlistSubscriptionDisplayModel {
	stateClass: string;
	isTrialCountdown: boolean;
	isCancellationScheduled: boolean;
	isInactive: boolean;
	tiles: readonly TrialTile[];
	trialDaysLeft?: number;
	trialDaysLeftWord?: string;
	cancellationEffectiveAt?: LocalTime;
	subscribeCtaLabel: string;
	subscribePlansPopoverId: string;
	priceStatement: string;
	renewalPrices: string;
	savesStayStatement: string;
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
		isTrialCountdown: banner.state === "trial-countdown",
		isCancellationScheduled: banner.state === "cancellation-scheduled",
		isInactive: banner.state === "inactive",
		subscribeCtaLabel: SUBSCRIBE_CTA_LABEL,
		subscribePlansPopoverId: SUBSCRIBE_PLANS_POPOVER_ID,
		priceStatement: PRICE_STATEMENT,
		renewalPrices: RENEWAL_PRICES,
		savesStayStatement: SAVES_STAY_STATEMENT,
	};
	switch (banner.state) {
		case "trial-countdown":
			return {
				...shared,
				tiles: trialTiles(banner.remaining),
				trialDaysLeft: banner.daysLeft,
				trialDaysLeftWord: banner.daysLeftWord,
			};
		case "cancellation-scheduled":
			return { ...shared, tiles: [], cancellationEffectiveAt: banner.cancellationEffectiveAt };
		case "inactive":
		case "none":
			return { ...shared, tiles: [] };
	}
}

export function renderReadlistSubscription(
	displayModel: ReadlistSubscriptionDisplayModel,
): string {
	return render(TEMPLATE, displayModel);
}
