import assert from "node:assert/strict";
import { SUBSCRIBE_CTA_LABEL, toAbsoluteDate } from "@packages/web-shell";
import { JSDOM } from "jsdom";
import { SUBSCRIBE_PLANS_POPOVER_ID } from "../../../shared/subscribe-plans/subscribe-plans.component";
import type { SubscriptionBannerState } from "../readlist.viewmodel";
import {
	renderReadlistDesignSubscription,
	toReadlistDesignSubscriptionDisplayModel,
} from "./readlist-design-subscription.component";

const CANCELLATION_EFFECTIVE_AT = toAbsoluteDate({ iso: "2026-01-15T00:00:00.000Z" });

const TRIAL_BANNER: SubscriptionBannerState = {
	state: "trial-countdown",
	daysLeft: 3,
	daysLeftWord: "days",
	remaining: { days: 3, hours: 4, minutes: 5, seconds: 6, totalMs: 271_506_000 },
};
const CANCELLATION_BANNER: SubscriptionBannerState = {
	state: "cancellation-scheduled",
	cancellationEffectiveAt: CANCELLATION_EFFECTIVE_AT,
};
const INACTIVE_BANNER: SubscriptionBannerState = { state: "inactive" };
const NONE_BANNER: SubscriptionBannerState = { state: "none" };

function display(banner: SubscriptionBannerState): Document {
	return new JSDOM(renderReadlistDesignSubscription(toReadlistDesignSubscriptionDisplayModel(banner))).window
		.document;
}

function banner(doc: Document): Element {
	const el = doc.querySelector("[data-test-subscription-banner]");
	assert(el, "the subscription banner must always render");
	return el;
}

function tile(doc: Document, unit: "days" | "hours" | "minutes"): Element {
	const el = doc.querySelector(`[data-test-trial-tile="${unit}"]`);
	assert(el, `the ${unit} tile must render during a trial countdown`);
	return el;
}

describe("toReadlistDesignSubscriptionDisplayModel / renderReadlistDesignSubscription", () => {
	it("classes the banner for the trial countdown and counts down in three tiles", () => {
		const doc = display(TRIAL_BANNER);

		expect(banner(doc).classList.contains("readlist-design-subscription--trial-countdown")).toBe(true);
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
		expect(trigger.textContent).toBe(SUBSCRIBE_CTA_LABEL);
		expect(fallback.textContent).toBe(SUBSCRIBE_CTA_LABEL);
		expect(fallback.getAttribute("href")).toContain("/account");
	});

	it("classes the banner for a scheduled cancellation and shows the effective date as a chip and in the body", () => {
		const doc = display(CANCELLATION_BANNER);

		expect(banner(doc).classList.contains("readlist-design-subscription--cancellation-scheduled")).toBe(true);
		const chip = doc.querySelector(".readlist-design-subscription__chip--warning time");
		assert(chip, "the cancellation chip must carry the effective date");
		expect(chip.textContent).toBe(CANCELLATION_EFFECTIVE_AT.label);
		const message = doc.querySelector("[data-test-banner-message] time");
		assert(message, "the cancellation body must carry the effective date");
		expect(message.textContent).toBe(CANCELLATION_EFFECTIVE_AT.label);
	});

	it("classes the banner inactive and shows an inactive chip with a resubscribe trigger and fallback", () => {
		const doc = display(INACTIVE_BANNER);

		expect(banner(doc).classList.contains("readlist-design-subscription--inactive")).toBe(true);
		const chip = doc.querySelector(".readlist-design-subscription__chip--error");
		assert(chip, "the inactive chip must render");
		expect(chip.textContent).toBe("Subscription inactive");
		const trigger = doc.querySelector('[data-test-action="subscribe-plans-open"]');
		const fallback = doc.querySelector('[data-test-action="resubscribe"]');
		assert(trigger, "the subscribe-plans trigger must render while inactive");
		assert(fallback, "the plain-link resubscribe fallback must render while inactive");
		expect(trigger.getAttribute("popovertarget")).toBe(SUBSCRIBE_PLANS_POPOVER_ID);
	});

	it("classes the banner none and offers no subscription action at all", () => {
		const doc = display(NONE_BANNER);

		expect(banner(doc).classList.contains("readlist-design-subscription--none")).toBe(true);
		expect(doc.querySelectorAll("[data-test-action]")).toHaveLength(0);
	});
});
