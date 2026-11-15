import { DEFAULT_BILLING_PLAN } from "@packages/provider-contracts/subscription-providers";
import {
	FEATURED_PLAN,
	PLAN_OFFERS,
	PRICING_PANELS,
	PRICING_PLANS,
	type PlanOffer,
	STATED_PRICING_PANELS,
	UPGRADE_CTA_LABEL,
	offerPrice,
	statedPrice,
	statedPricingPlans,
} from "./pricing";

const NOV_15_2026 = new Date("2026-11-15T00:00:00.000Z");

const firstYear49ForEveryone: PlanOffer = {
	id: "first-year-49",
	plan: "yearly",
	amountOffUsd: 11,
	duration: "once",
	audience: "everyone",
	endsAt: new Date("2027-02-01T00:00:00.000Z"),
};

describe("statedPrice", () => {
	it("states the list price when no offer exists", () => {
		expect(statedPrice({ plan: "yearly", offers: [], now: NOV_15_2026 })).toEqual({
			firstChargeUsd: 60,
			renewalUsd: 60,
			firstCharge: "$60",
			renewal: "$60",
		});
	});

	it("states the first charge after a once-off discount for everyone, then the list price", () => {
		expect(statedPrice({ plan: "yearly", offers: [firstYear49ForEveryone], now: NOV_15_2026 })).toEqual({
			firstChargeUsd: 49,
			renewalUsd: 60,
			firstCharge: "$49",
			renewal: "$60",
		});
	});

	it("states the discounted price on every charge for a forever discount with no end date", () => {
		const { endsAt: _endsAt, ...openEnded } = firstYear49ForEveryone;
		expect(
			statedPrice({ plan: "yearly", offers: [{ ...openEnded, duration: "forever" }], now: NOV_15_2026 }),
		).toEqual({ firstChargeUsd: 49, renewalUsd: 49, firstCharge: "$49", renewal: "$49" });
	});

	it("states the list price when the offer is only for eligible readers", () => {
		expect(
			statedPrice({ plan: "yearly", offers: [{ ...firstYear49ForEveryone, audience: "eligible-readers" }], now: NOV_15_2026 }),
		).toEqual({ firstChargeUsd: 60, renewalUsd: 60, firstCharge: "$60", renewal: "$60" });
	});

	it("states the list price once the offer for everyone has ended", () => {
		expect(
			statedPrice({ plan: "yearly", offers: [firstYear49ForEveryone], now: new Date("2027-02-01T00:00:00.000Z") }),
		).toEqual({ firstChargeUsd: 60, renewalUsd: 60, firstCharge: "$60", renewal: "$60" });
	});

	it("states the list price on a plan the offer does not apply to", () => {
		expect(statedPrice({ plan: "monthly", offers: [firstYear49ForEveryone], now: NOV_15_2026 }).firstCharge).toBe("$10");
	});

	it("refuses two offers for everyone on one plan, since the copy could state only one", () => {
		expect(() =>
			statedPrice({ plan: "yearly", offers: [firstYear49ForEveryone, firstYear49ForEveryone], now: NOV_15_2026 }),
		).toThrow("at most one offer for everyone may apply to the yearly plan at once");
	});
});

describe("offerPrice", () => {
	it("advertises $49 for the keep offer's first year, matching the $11 Stripe coupon on the $60 yearly plan", () => {
		expect(PLAN_OFFERS.firstYear49.amountOffUsd).toBe(11);
		expect(offerPrice(PLAN_OFFERS.firstYear49)).toEqual({
			firstChargeUsd: 49,
			renewalUsd: 60,
			firstCharge: "$49",
			renewal: "$60",
		});
	});

	it("keeps the keep offer for eligible readers until 2027-02-01, so public copy states list prices", () => {
		expect(PLAN_OFFERS.firstYear49.audience).toBe("eligible-readers");
		expect(PLAN_OFFERS.firstYear49.endsAt.toISOString()).toBe("2027-02-01T00:00:00.000Z");
	});
});

describe("statedPricingPlans", () => {
	it("states every plan field at list price with today's catalog", () => {
		expect(statedPricingPlans({ offers: Object.values(PLAN_OFFERS), now: NOV_15_2026 })).toEqual(PRICING_PLANS);
	});

	it("names the period with the charge", () => {
		expect(PRICING_PLANS.monthly.periodDisplay).toBe("$10 a month");
		expect(PRICING_PLANS.yearly.periodDisplay).toBe("$60 a year");
		expect(PRICING_PLANS.triennial.periodDisplay).toBe("$108 every 3 years");
	});

	it("states the discounted first year and the renewal on every yearly field under a once-off offer for everyone", () => {
		const { yearly, monthly } = statedPricingPlans({ offers: [firstYear49ForEveryone], now: NOV_15_2026 });

		expect(yearly).toEqual({
			name: "Yearly",
			monthlyAmount: "4.08",
			monthlyDisplay: "$4.08",
			totalAmount: "49",
			totalDisplay: "$49",
			periodDisplay: "$49 for the first year, then $60 a year",
			billedNote: "$49 for the first year, then $60 billed once a year",
			billedLine: "Billed $49 for the first year, then $60 once a year",
			summaryName: "Yearly plan",
			cadenceDisplay: "$49 for the first year, then $60/year",
		});
		expect(monthly).toEqual(PRICING_PLANS.monthly);
	});

	it("states the discounted price as the plan's price under a forever offer for everyone", () => {
		const { yearly } = statedPricingPlans({
			offers: [{ ...firstYear49ForEveryone, duration: "forever" }],
			now: NOV_15_2026,
		});

		expect(yearly.periodDisplay).toBe("$49 a year");
		expect(yearly.billedNote).toBe("$49 billed once a year");
		expect(yearly.billedLine).toBe("Billed $49 once a year");
		expect(yearly.cadenceDisplay).toBe("$49/year");
	});
});

describe("PRICING_PLANS", () => {
	it("quotes a whole-dollar monthly figure for every plan, so no surface has to round one", () => {
		expect(PRICING_PLANS.monthly.monthlyDisplay).toBe("$10");
		expect(PRICING_PLANS.yearly.monthlyDisplay).toBe("$5");
		expect(PRICING_PLANS.triennial.monthlyDisplay).toBe("$3");
	});

	it("charges the card the whole billing period, not the monthly figure", () => {
		expect(PRICING_PLANS.monthly.totalDisplay).toBe("$10");
		expect(PRICING_PLANS.yearly.totalDisplay).toBe("$60");
		expect(PRICING_PLANS.triennial.totalDisplay).toBe("$108");
	});

	it("names the charge and its cadence together, so a monthly figure never stands alone", () => {
		expect(PRICING_PLANS.monthly.billedNote).toBe("$10 billed monthly");
		expect(PRICING_PLANS.yearly.billedNote).toBe("$60 billed once a year");
		expect(PRICING_PLANS.triennial.billedNote).toBe("$108 billed once every 3 years");
	});

	it("states the charge before its cadence on a plan row", () => {
		expect(PRICING_PLANS.monthly.billedLine).toBe("Billed $10 every month");
		expect(PRICING_PLANS.yearly.billedLine).toBe("Billed $60 once a year");
		expect(PRICING_PLANS.triennial.billedLine).toBe("Billed $108 every 3 years");
		expect(PRICING_PLANS.monthly.billedLine).toContain(PRICING_PLANS.monthly.totalDisplay);
		expect(PRICING_PLANS.yearly.billedLine).toContain(PRICING_PLANS.yearly.totalDisplay);
		expect(PRICING_PLANS.triennial.billedLine).toContain(PRICING_PLANS.triennial.totalDisplay);
	});

	it("names each plan for the account page's plan summary", () => {
		expect(PRICING_PLANS.monthly.summaryName).toBe("Monthly plan");
		expect(PRICING_PLANS.yearly.summaryName).toBe("Yearly plan");
		expect(PRICING_PLANS.triennial.summaryName).toBe("3-year plan");
	});

	it("quotes the whole-period charge with its cadence in the brand's price format", () => {
		expect(PRICING_PLANS.monthly.cadenceDisplay).toBe("$10/month");
		expect(PRICING_PLANS.yearly.cadenceDisplay).toBe("$60/year");
		expect(PRICING_PLANS.triennial.cadenceDisplay).toBe("$108 every 3 years");
		expect(PRICING_PLANS.monthly.cadenceDisplay.startsWith(PRICING_PLANS.monthly.totalDisplay)).toBe(true);
		expect(PRICING_PLANS.yearly.cadenceDisplay.startsWith(PRICING_PLANS.yearly.totalDisplay)).toBe(true);
		expect(PRICING_PLANS.triennial.cadenceDisplay.startsWith(PRICING_PLANS.triennial.totalDisplay)).toBe(true);
	});

	it("derives each monthly figure from the amount actually charged, so the two cannot drift", () => {
		expect(Number(PRICING_PLANS.monthly.monthlyAmount) * 1).toBe(
			Number(PRICING_PLANS.monthly.totalAmount),
		);
		expect(Number(PRICING_PLANS.yearly.monthlyAmount) * 12).toBe(
			Number(PRICING_PLANS.yearly.totalAmount),
		);
		expect(Number(PRICING_PLANS.triennial.monthlyAmount) * 36).toBe(
			Number(PRICING_PLANS.triennial.totalAmount),
		);
	});

	it("gets cheaper per month the longer the commitment, and dearer per charge", () => {
		const perMonth = [
			Number(PRICING_PLANS.monthly.monthlyAmount),
			Number(PRICING_PLANS.yearly.monthlyAmount),
			Number(PRICING_PLANS.triennial.monthlyAmount),
		];
		const perCharge = [
			Number(PRICING_PLANS.monthly.totalAmount),
			Number(PRICING_PLANS.yearly.totalAmount),
			Number(PRICING_PLANS.triennial.totalAmount),
		];
		expect(perMonth).toEqual([...perMonth].sort((a, b) => b - a));
		expect(perCharge).toEqual([...perCharge].sort((a, b) => a - b));
	});

	it("carries symbol-free amounts matching the displayed ones, so a surface that sets the currency itself cannot quote a different price", () => {
		expect(PRICING_PLANS.yearly.monthlyAmount).toBe("5");
		expect(PRICING_PLANS.yearly.totalAmount).toBe("60");
		expect(PRICING_PLANS.yearly.monthlyDisplay).toBe(
			`$${PRICING_PLANS.yearly.monthlyAmount}`,
		);
		expect(PRICING_PLANS.yearly.totalDisplay).toBe(`$${PRICING_PLANS.yearly.totalAmount}`);
	});
});

describe("PRICING_PANELS", () => {
	it("reads dearest-per-month first, so the plan the page wants picked sits in the middle", () => {
		expect(PRICING_PANELS.map((panel) => panel.key)).toEqual([
			"monthly",
			"yearly",
			"triennial",
		]);
	});

	it("badges the middle plan alone", () => {
		expect(PRICING_PANELS.map((panel) => panel.badge)).toEqual([
			undefined,
			"Most popular",
			undefined,
		]);
		expect(PRICING_PANELS.map((panel) => panel.featured)).toEqual([false, true, false]);
	});

	it("features the plan every no-choice path charges", () => {
		expect(FEATURED_PLAN).toBe(DEFAULT_BILLING_PLAN);
		expect(FEATURED_PLAN).toBe("yearly");
	});

	it("carries the same copy the plan table holds, so a panel cannot quote its own price", () => {
		expect(PRICING_PANELS.map((panel) => panel.monthlyDisplay)).toEqual([
			PRICING_PLANS.monthly.monthlyDisplay,
			PRICING_PLANS.yearly.monthlyDisplay,
			PRICING_PLANS.triennial.monthlyDisplay,
		]);
		expect(PRICING_PANELS.map((panel) => panel.billedNote)).toEqual([
			PRICING_PLANS.monthly.billedNote,
			PRICING_PLANS.yearly.billedNote,
			PRICING_PLANS.triennial.billedNote,
		]);
		expect(PRICING_PANELS.map((panel) => panel.billedLine)).toEqual([
			PRICING_PLANS.monthly.billedLine,
			PRICING_PLANS.yearly.billedLine,
			PRICING_PLANS.triennial.billedLine,
		]);
		expect(PRICING_PANELS.map((panel) => panel.name)).toEqual([
			"Monthly",
			"Yearly",
			"Every 3 years",
		]);
	});
});

describe("STATED_PRICING_PANELS", () => {
	it("lists only the plans the price statement names", () => {
		expect(STATED_PRICING_PANELS.map((panel) => panel.key)).toEqual(["monthly", "yearly"]);
	});

	it("leaves the 3-year plan on the full list the plans page renders", () => {
		expect(PRICING_PANELS.map((panel) => panel.key)).toEqual(["monthly", "yearly", "triennial"]);
	});
});

describe("UPGRADE_CTA_LABEL", () => {
	it("names the action and leaves the price to the sentence beside it", () => {
		expect(UPGRADE_CTA_LABEL).toBe("Upgrade");
	});
});
