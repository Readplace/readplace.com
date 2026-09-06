import { DEFAULT_BILLING_PLAN } from "@packages/provider-contracts/subscription-providers";
import {
	CHEAPEST_MONTHLY_DISPLAY,
	FEATURED_PLAN,
	PRICING_PANELS,
	PRICING_PLANS,
	SUBSCRIBE_CTA_LABEL,
} from "./pricing";

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
		expect(PRICING_PANELS.map((panel) => panel.name)).toEqual([
			"Monthly",
			"Yearly",
			"Every 3 years",
		]);
	});
});

describe("CHEAPEST_MONTHLY_DISPLAY", () => {
	it("is the lowest monthly figure any plan reaches, so a single-price mention states a price a reader can actually pay", () => {
		expect(CHEAPEST_MONTHLY_DISPLAY).toBe("$3");
		expect(CHEAPEST_MONTHLY_DISPLAY).toBe(PRICING_PLANS.triennial.monthlyDisplay);
	});
});

describe("SUBSCRIBE_CTA_LABEL", () => {
	it("quotes the cheapest monthly figure", () => {
		expect(SUBSCRIBE_CTA_LABEL).toBe("Subscribe — $3/month");
	});
});
