import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderOfferPopup } from "./offer-popup.component";
import { OFFER_POPUP_STYLES } from "./offer-popup.styles";

function parse(): Document {
	return new JSDOM(renderOfferPopup()).window.document;
}

describe("renderOfferPopup", () => {
	it("ships hidden behind the open-state class and starts on the offer step", () => {
		const root = parse().querySelector("[data-test-offer-popup]");
		assert(root, "popup root must render");
		assert.equal(root.classList.contains("offer-popup--open"), false);
		assert.equal(root.getAttribute("data-offer-stage"), "offer");
	});

	it("renders the static scarcity figures that drive urgency", () => {
		const doc = parse();

		const claimed = doc.querySelector("[data-test-offer-claimed]");
		assert(claimed, "claimed counter must render");
		assert.equal(claimed.textContent, "46 / 50");

		const remaining = doc.querySelector("[data-test-offer-remaining]");
		assert(remaining, "remaining counter must render");
		assert.equal(remaining.textContent, "4");

		const fill = doc.querySelector(".offer-popup__scarcity-fill");
		assert(fill, "scarcity fill must render");
		assert.equal(fill.getAttribute("style"), "width: 92%");
	});

	it("renders the one-time price with a crossed-out anchor", () => {
		const doc = parse();

		const price = doc.querySelector("[data-test-offer-price]");
		assert(price, "price must render");
		assert.match(price.textContent ?? "", /US\$49/);

		const anchor = doc.querySelector("[data-test-offer-anchor]");
		assert(anchor, "anchor price must render");
		assert.equal(anchor.textContent, "US$3.99 over 3 years");
	});

	it("seeds the countdown the client takes over", () => {
		const clock = parse().querySelector("[data-offer-countdown]");
		assert(clock, "countdown clock must render");
		assert.equal(clock.textContent, "10:00");
	});

	it("renders every close-flow action the client wires up", () => {
		const doc = parse();
		const actions = Array.from(
			doc.querySelectorAll("[data-offer-action]"),
		).map((el) => el.getAttribute("data-offer-action"));
		assert.deepEqual(actions, ["close", "keep", "confirm", "keep", "dismiss"]);
	});

	it("points the call to action at a destination", () => {
		const cta = parse().querySelector("[data-test-offer-cta]");
		assert(cta, "cta must render");
		assert.equal(cta.getAttribute("href"), "/account");
	});

	it("publishes the stylesheet that scopes the popup", () => {
		assert.match(OFFER_POPUP_STYLES, /\.offer-popup__panel/);
	});
});
