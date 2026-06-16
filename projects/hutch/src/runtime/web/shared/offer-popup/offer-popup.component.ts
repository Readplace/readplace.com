import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";

const TEMPLATE = readFileSync(join(__dirname, "offer-popup.template.html"), "utf-8");

const TOTAL_SLOTS = 50;
const CLAIMED_SLOTS = 46;
const PRICE_AUD = 99;
/** Crossed-out anchor price that frames the one-time fee as a saving. */
const ANCHOR_PRICE_AUD = 240;
const VIEWERS_COUNT = 11;
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
		priceAud: PRICE_AUD,
		anchorPriceAud: ANCHOR_PRICE_AUD,
		viewersCount: VIEWERS_COUNT,
		countdownInitial: COUNTDOWN_INITIAL,
		ctaHref: CTA_HREF,
	});
}
