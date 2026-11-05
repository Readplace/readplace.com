import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { CHECKOUT_OFFERS, type CheckoutOffer } from "@packages/provider-contracts/hosted-checkout";
import { PRICING_PLANS } from "@packages/web-shell";
import { KEEP_OFFER_FIRST_YEAR_PRICE } from "../../../domain/engagement/keep-offer";
import { renderReadlistKeepOffer, toReadlistKeepOfferDisplayModel } from "./readlist-keep-offer.component";

const TRIAL_ENDS_AT = "2026-11-28T00:00:00.000Z";

function shownOffer(offer: CheckoutOffer) {
	const html = renderReadlistKeepOffer(
		toReadlistKeepOfferDisplayModel({
			shown: true,
			trialEndsAt: TRIAL_ENDS_AT,
			trialDay: 2,
			savesCount: 3,
			offer,
		}),
	);
	const aside = new JSDOM(html).window.document.querySelector("[data-test-keep-offer]");
	assert(aside, "the keep offer aside must always be rendered");
	return aside;
}

function formPosting(aside: Element, path: string): HTMLFormElement {
	const form = Array.from(aside.querySelectorAll("form")).find((candidate) =>
		candidate.getAttribute("action")?.startsWith(path),
	);
	assert(form, `the keep offer must post to ${path}`);
	return form;
}

function hiddenValue(form: Element, name: string): string | null {
	const input = form.querySelector(`input[type="hidden"][name="${name}"]`);
	assert(input, `the form must carry a hidden ${name}`);
	return input.getAttribute("value");
}

describe("renderReadlistKeepOffer", () => {
	it("renders the empty aside with the hidden state class when the reader is not eligible", () => {
		const html = renderReadlistKeepOffer(
			toReadlistKeepOfferDisplayModel({ shown: false, reason: "not-trial" }),
		);

		const aside = new JSDOM(html).window.document.querySelector("[data-test-keep-offer]");
		assert(aside, "the keep offer aside must always be rendered");
		expect(aside.classList.contains("readlist-keep-offer--hidden")).toBe(true);
		expect(aside.classList.contains("readlist-keep-offer--shown")).toBe(false);
		expect(aside.textContent?.trim()).toBe("");
	});

	it("heads the shown aside with how many articles the reader kept", () => {
		const aside = shownOffer(CHECKOUT_OFFERS.firstYear49);

		expect(aside.classList.contains("readlist-keep-offer--shown")).toBe(true);
		expect(aside.classList.contains("readlist-keep-offer--hidden")).toBe(false);
		expect(aside.querySelector("h2")?.textContent).toBe("You've kept 3 articles this week.");
	});

	it("states the first-year price, the later price, the charge date and the reminder in the offer variant", () => {
		const aside = shownOffer(CHECKOUT_OFFERS.firstYear49);
		const body = aside.querySelector("[data-test-keep-offer-body]");
		assert(body, "the shown aside must render its body");
		const trialEnd = body.querySelector("time");
		assert(trialEnd, "the charge date must be a <time> element");

		expect(trialEnd.getAttribute("datetime")).toBe(TRIAL_ENDS_AT);
		expect(trialEnd.hasAttribute("data-local-time")).toBe(true);
		expect(body.textContent).toBe(
			`Choose during your trial: ${KEEP_OFFER_FIRST_YEAR_PRICE} for your first year, then ${PRICING_PLANS.yearly.totalDisplay} a year. Add a card now and nothing is charged until ${trialEnd.textContent}. A reminder email arrives a week before. Your saves stay readable and exportable either way.`,
		);
	});

	it("states only the standing prices in the plain variant", () => {
		const aside = shownOffer(CHECKOUT_OFFERS.none);
		const body = aside.querySelector("[data-test-keep-offer-body]");
		assert(body, "the shown aside must render its body");

		expect(body.textContent).toContain(
			`Choose during your trial: ${PRICING_PLANS.yearly.totalDisplay} a year, or ${PRICING_PLANS.monthly.totalDisplay} a month. Add a card now`,
		);
		expect(body.textContent).not.toContain(KEEP_OFFER_FIRST_YEAR_PRICE);
	});

	it("posts Keep Readplace to the subscribe route with the yearly plan and the eligible offer, attributed to the panel", () => {
		for (const offer of [CHECKOUT_OFFERS.firstYear49, CHECKOUT_OFFERS.none]) {
			const form = formPosting(shownOffer(offer), "/account/subscribe");

			expect(form.getAttribute("method")).toBe("POST");
			const action = new URL(form.getAttribute("action") ?? "", "https://readplace.test");
			expect(action.searchParams.get("utm_source")).toBe("keep-panel");
			expect(action.searchParams.get("utm_content")).toBe("keep");
			expect(hiddenValue(form, "plan")).toBe("yearly");
			expect(hiddenValue(form, "offer")).toBe(offer);
			expect(form.querySelector("button")?.textContent).toBe("Keep Readplace");
		}
	});

	it("posts Not now to the dismiss route", () => {
		const form = formPosting(shownOffer(CHECKOUT_OFFERS.firstYear49), "/queue/keep-offer/dismiss");

		expect(form.getAttribute("method")).toBe("POST");
		const action = new URL(form.getAttribute("action") ?? "", "https://readplace.test");
		expect(action.searchParams.get("utm_source")).toBe("keep-panel");
		expect(action.searchParams.get("utm_content")).toBe("not-now");
		expect(form.querySelector("button")?.textContent).toBe("Not now");
	});
});
