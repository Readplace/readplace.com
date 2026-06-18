import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "offer-popup.template.html"), "utf-8");

const PRICE_USD = 39;
/** Crossed-out anchor price that frames the one-time fee as a saving. */
const ANCHOR_PRICE_USD = 140;

export const OFFER_POPUP_SCRIPT = `<script src="/client-dist/offer-popup.client.js" defer></script>`;

export function renderOfferPopup(ctaHref: string): string {
	return render(TEMPLATE, {
		priceUsd: PRICE_USD,
		anchorPriceUsd: ANCHOR_PRICE_USD,
		ctaHref,
	});
}
