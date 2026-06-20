import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderOfferPopup } from "./offer-popup.component";
import { OFFER_POPUP_STYLES } from "./offer-popup.styles";

const TEST_CTA_LINK = "https://buy.stripe.com/test_offer-popup-cta";

function parse(): Document {
	return new JSDOM(renderOfferPopup(TEST_CTA_LINK)).window.document;
}

describe("renderOfferPopup", () => {
	it("ships hidden behind the open-state class and starts on the offer step", () => {
		const root = parse().querySelector("[data-test-offer-popup]");
		assert(root, "popup root must render");
		assert.equal(root.classList.contains("offer-popup--open"), false);
		assert.equal(root.getAttribute("data-offer-stage"), "offer");
	});

	it("renders the one-time price with a crossed-out anchor", () => {
		const doc = parse();

		const price = doc.querySelector("[data-test-offer-price]");
		assert(price, "price must render");
		assert.match(price.textContent ?? "", /\$39/);

		const anchor = doc.querySelector("[data-test-offer-anchor]");
		assert(anchor, "anchor price must render");
		assert.equal(anchor.textContent, "$147 over 3 years");
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
		assert.equal(cta.getAttribute("href"), TEST_CTA_LINK);
	});

	it("publishes the stylesheet that scopes the popup", () => {
		assert.match(OFFER_POPUP_STYLES, /\.offer-popup__panel/);
	});
});
