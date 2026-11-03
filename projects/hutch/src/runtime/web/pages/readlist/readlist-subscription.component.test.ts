import assert from "node:assert/strict";
import { PRICING_PLANS, toAbsoluteDate } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import { PRICE_STATEMENT, RENEWAL_PRICES, SAVES_STAY_STATEMENT } from "../../price-statement";
import { SUBSCRIBE_PLANS_POPOVER_ID } from "../../shared/subscribe-plans/subscribe-plans.component";
import type { SubscriptionBannerState } from "./readlist.viewmodel";
import {
	renderReadlistSubscription,
	toReadlistSubscriptionDisplayModel,
} from "./readlist-subscription.component";

const CANCELLATION_EFFECTIVE_AT = toAbsoluteDate({ iso: "2026-01-15T00:00:00.000Z" });

const TRIAL_BANNER: SubscriptionBannerState = {
	state: "trial-countdown",
	daysLeft: 3,
	daysLeftWord: "days",
	remaining: { days: 3, hours: 4, minutes: 5, seconds: 6, totalMs: 271_506_000 },
	checkedPlan: "yearly",
};
const TRIAL_STATUS_BANNER: SubscriptionBannerState = {
	state: "trial-status",
	daysLeft: 12,
	daysLeftWord: "days",
};
const CANCELLATION_BANNER: SubscriptionBannerState = {
	state: "cancellation-scheduled",
	cancellationEffectiveAt: CANCELLATION_EFFECTIVE_AT,
};
const INACTIVE_BANNER: SubscriptionBannerState = { state: "inactive", checkedPlan: "yearly" };
const NONE_BANNER: SubscriptionBannerState = { state: "none" };

function display(banner: SubscriptionBannerState): Document {
	return new JSDOM(renderReadlistSubscription(toReadlistSubscriptionDisplayModel(banner))).window
		.document;
}

function banner(doc: Document): Element {
	const el = doc.querySelector("[data-test-subscription-banner]");
	assert(el, "the subscription banner must always render");
	return el;
}

function pricingLines(doc: Document): { price: (string | null)[]; savesStay: (string | null)[] } {
	const textOf = (selector: string) => [...doc.querySelectorAll(selector)].map((el) => el.textContent);
	return { price: textOf("[data-test-price-statement]"), savesStay: textOf("[data-test-saves-stay]") };
}

function tile(doc: Document, unit: "days" | "hours" | "minutes"): Element {
	const el = doc.querySelector(`[data-test-trial-tile="${unit}"]`);
	assert(el, `the ${unit} tile must render during a trial countdown`);
	return el;
}

describe("toReadlistSubscriptionDisplayModel / renderReadlistSubscription", () => {
	it("renders only the status line while the trial is not yet near its end", () => {
		const doc = display(TRIAL_STATUS_BANNER);

		expect(banner(doc).classList.contains("readlist-subscription--trial-status")).toBe(true);
		expect(banner(doc).textContent?.trim()).toBe(
			`Trial · 12 days left · then ${PRICING_PLANS.yearly.totalDisplay} a year or ${PRICING_PLANS.monthly.totalDisplay} a month`,
		);
	});

	it("titles the countdown with the days left and keeps only the price and saves notes", () => {
		const doc = display({ ...TRIAL_BANNER, daysLeft: 2, daysLeftWord: "days" });

		const title = doc.querySelector(".readlist-subscription__title");
		assert(title, "the countdown title must render");
		expect(title.textContent?.trim()).toBe("Your trial ends in 2 days");
		const paragraphs = [...banner(doc).querySelectorAll("p")].map((p) => p.textContent?.trim());
		expect(paragraphs).toEqual([`${PRICE_STATEMENT} Cancel anytime.`, SAVES_STAY_STATEMENT]);
	});

	it("words the countdown title in the singular on the last day", () => {
		const doc = display({ ...TRIAL_BANNER, daysLeft: 1, daysLeftWord: "day" });

		const title = doc.querySelector(".readlist-subscription__title");
		assert(title, "the countdown title must render");
		expect(title.textContent?.trim()).toBe("Your trial ends in 1 day");
	});

	it("classes the banner for the trial countdown and counts down in three tiles", () => {
		const doc = display(TRIAL_BANNER);

		expect(banner(doc).classList.contains("readlist-subscription--trial-countdown")).toBe(true);
		expect(tile(doc, "days").textContent).toBe("3");
		expect(tile(doc, "hours").textContent).toBe("4");
		expect(tile(doc, "minutes").textContent).toBe("5");
	});

	it("tells a screen reader how many days are left, in words, without repeating the tiles", () => {
		const doc = display(TRIAL_BANNER);

		const daysLeft = doc.querySelector("[data-test-trial-days-left]");
		assert(daysLeft, "the sr-only days-left line must render during a trial countdown");
		expect(daysLeft.textContent).toBe("3 days left");
	});

	it("offers the subscribe popover trigger alongside a plain-link fallback, both worded the same", () => {
		const doc = display(TRIAL_BANNER);

		const trigger = doc.querySelector('[data-test-action="subscribe-plans-open"]');
		const fallback = doc.querySelector('[data-test-action="subscribe"]');
		assert(trigger, "the subscribe-plans trigger must render during a trial countdown");
		assert(fallback, "the plain-link fallback must render during a trial countdown");
		expect(trigger.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
		expect(trigger.textContent).toBe("Subscribe");
		expect(fallback.textContent).toBe("Subscribe");
		expect(fallback.getAttribute("href")).toContain("/account");
	});

	it("classes the banner for a scheduled cancellation and shows the effective date as a chip and in the body", () => {
		const doc = display(CANCELLATION_BANNER);

		expect(banner(doc).classList.contains("readlist-subscription--cancellation-scheduled")).toBe(true);
		const chip = doc.querySelector('[data-test-subscription-chip="cancellation-scheduled"] time');
		assert(chip, "the cancellation chip must carry the effective date");
		expect(chip.textContent).toBe(CANCELLATION_EFFECTIVE_AT.label);
		const message = doc.querySelector("[data-test-banner-message] time");
		assert(message, "the cancellation body must carry the effective date");
		expect(message.textContent).toBe(CANCELLATION_EFFECTIVE_AT.label);
	});

	it("classes the banner inactive and shows an inactive chip with a resubscribe trigger and fallback", () => {
		const doc = display(INACTIVE_BANNER);

		expect(banner(doc).classList.contains("readlist-subscription--inactive")).toBe(true);
		const chip = doc.querySelector('[data-test-subscription-chip="inactive"]');
		assert(chip, "the inactive chip must render");
		expect(chip.textContent).toBe("Subscription inactive");
		const trigger = doc.querySelector('[data-test-action="subscribe-plans-open"]');
		const fallback = doc.querySelector('[data-test-action="resubscribe"]');
		assert(trigger, "the subscribe-plans trigger must render while inactive");
		assert(fallback, "the plain-link resubscribe fallback must render while inactive");
		expect(trigger.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
	});

	it("states the trial price and the saves line under the subscribe action during a trial countdown", () => {
		expect(pricingLines(display(TRIAL_BANNER))).toEqual({
			price: [`${PRICE_STATEMENT} Cancel anytime.`],
			savesStay: [SAVES_STAY_STATEMENT],
		});
	});

	it("states the renewal prices without the trial clause once the subscription is inactive", () => {
		expect(pricingLines(display(INACTIVE_BANNER))).toEqual({
			price: [RENEWAL_PRICES],
			savesStay: [SAVES_STAY_STATEMENT],
		});
	});

	it.each([
		["a scheduled cancellation", CANCELLATION_BANNER],
		["no banner state", NONE_BANNER],
	])("quotes no price for %s", (_state, state) => {
		expect(pricingLines(display(state))).toEqual({ price: [], savesStay: [] });
	});

	it("classes the banner none and offers no subscription action at all", () => {
		const doc = display(NONE_BANNER);

		expect(banner(doc).classList.contains("readlist-subscription--none")).toBe(true);
		expect(doc.querySelectorAll("[data-test-action]")).toHaveLength(0);
	});
});
