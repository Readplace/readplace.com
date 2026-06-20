import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { STANDARD_YEARLY_USD } from "../../pricing";

const TEMPLATE = readFileSync(join(__dirname, "offer-popup.template.html"), "utf-8");

const PRICE_USD = 39;
const ANCHOR_PRICE_USD = STANDARD_YEARLY_USD * 3;

export const OFFER_POPUP_SCRIPT = `<script src="/client-dist/offer-popup.client.js" defer></script>`;

export function renderOfferPopup(ctaHref: string): string {
	return render(TEMPLATE, {
		priceUsd: PRICE_USD,
		anchorPriceUsd: ANCHOR_PRICE_USD,
		ctaHref,
	});
}
