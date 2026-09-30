import { OCR_SCRIPT_PACKS, type OcrScriptPack } from "@packages/crawl-article";
import { CHEAPEST_MONTHLY_DISPLAY, PRICING_PLANS, withInternalTracking } from "@packages/web-shell";

import { STRIPE_TRIAL_PERIOD_DAYS } from "../../../domain/stripe/stripe-trial-config";
import type {
	IsoDay,
	LandingPageAction,
	LandingPageActionInput,
	LandingPageContent,
	LandingPageSlug,
} from "./landing-pages.types";

/**
 * The sentences and assets more than one landing page needs. They live together
 * so a page cannot quietly grow its own wording for a shared claim: four
 * paraphrases of one fact are four things to re-verify when the fact changes,
 * and the first one to go stale is the one nobody remembers exists.
 */

export const PASTE_A_LINK: LandingPageActionInput = {
	name: "url",
	label: "Link to a PDF or article",
	placeholder: "https://example.com/paper.pdf",
};

export const READLIST_SHOT = {
	path: "/screenshots/queue.webp",
	alt: "The Readplace readlist listing saved articles with thumbnails and short previews",
	width: 1440,
	height: 900,
} as const;

export const READER_SHOT = {
	path: "/screenshots/reader-tldr.webp",
	alt: "The Readplace reader showing an article with its AI summary expanded",
	width: 1440,
	height: 900,
} as const;

/** The one testimonial the product has. There is no second one to reach for, so
 * a page that needs more credibility than this reaches for the mechanism
 * instead. */
export const EARLY_USER_QUOTE = {
	text: "It just works.",
	attribution: "Matthew Motz, early user",
};

export function founderLine(slug: LandingPageSlug): string {
	const href = withInternalTracking("/blog/why-readplace-exists", {
		source: `lp-${slug}-founder`,
		content: "blog-why",
	});
	return `Fayner Brack, Founder & CEO of Readplace, wrote js-cookie, which browsers download about 22 billion times a year, and ran his own reading pipeline for ten years before it became Readplace. <a href="${href}">Why Readplace exists</a>.`;
}

export const TRIAL_TERMS = `${STRIPE_TRIAL_PERIOD_DAYS} days free, no card. After that ${CHEAPEST_MONTHLY_DISPLAY}/month.`;

export const PLAN_CHOICES = `${PRICING_PLANS.monthly.billedNote}, ${PRICING_PLANS.yearly.billedNote}, or ${PRICING_PLANS.triennial.billedNote}`;

/** The sentence this whole product is arguing for. Every offer section lands on
 * it, because for a reader who has already lost one readlist it answers the
 * objection that a price tag raises. */
export const READ_ONLY_CLOSE =
	"If you never subscribe, nothing is charged and the account goes read-only, not dark — you keep reading every article you saved, and you can still export.";

export const START_TRIAL: LandingPageAction = {
	key: "signup",
	label: `Start your ${STRIPE_TRIAL_PERIOD_DAYS}-day free trial`,
	href: "/signup",
};

export const SHARED_LANDING_COPY_LAST_MODIFIED: IsoDay = "2026-10-01";

export function landingPageLastModified(page: Pick<LandingPageContent, "lastModified">): IsoDay {
	return page.lastModified > SHARED_LANDING_COPY_LAST_MODIFIED
		? page.lastModified
		: SHARED_LANDING_COPY_LAST_MODIFIED;
}

export const OCR_TESTED_LANGUAGE_BY_PACK: Record<OcrScriptPack, string> = {
	Arabic: "Arabic",
	Bengali: "Bengali",
	Cyrillic: "Russian",
	Devanagari: "Hindi",
	Greek: "Greek",
	HanS: "Chinese",
	Hangul: "Korean",
	Hebrew: "Hebrew",
	Japanese: "Japanese",
	Kannada: "Kannada",
	Latin: "English",
	Malayalam: "Malayalam",
	Tamil: "Tamil",
	Telugu: "Telugu",
	Thai: "Thai",
};

export const OCR_TESTED_LANGUAGES = new Intl.ListFormat("en", { type: "conjunction" }).format(
	[...Object.values(OCR_TESTED_LANGUAGE_BY_PACK)].sort(),
);

export const OCR_LANGUAGES_ANSWER = `Scans in ${OCR_SCRIPT_PACKS.length} scripts, each checked against a real scanned page in one language: ${OCR_TESTED_LANGUAGES}. Other languages written in those scripts go through the same model, but only these were tested. Traditional Chinese is read with the Simplified model.`;
