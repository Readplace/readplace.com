import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "offer-popup.template.html"), "utf-8");

const TOTAL_SLOTS = 50;
const CLAIMED_SLOTS = 46;
const PRICE_USD = 49;
/** Crossed-out anchor price that frames the one-time fee as a saving. */
const ANCHOR_PRICE_USD = 3.99;
const COUNTDOWN_INITIAL = "10:00";
const CTA_HREF = "/account";

export const OFFER_POPUP_SCRIPT = `<script src="/client-dist/offer-popup.client.js" defer></script>`;

export function renderOfferPopup(): string {
	const remainingSlots = TOTAL_SLOTS - CLAIMED_SLOTS;
	const claimedPercent = Math.round((CLAIMED_SLOTS / TOTAL_SLOTS) * 100);
	return render(TEMPLATE, {
		totalSlots: TOTAL_SLOTS,
		claimedSlots: CLAIMED_SLOTS,
		remainingSlots,
		claimedPercent,
		priceUsd: PRICE_USD,
		anchorPriceUsd: ANCHOR_PRICE_USD,
		countdownInitial: COUNTDOWN_INITIAL,
		ctaHref: CTA_HREF,
	});
}
