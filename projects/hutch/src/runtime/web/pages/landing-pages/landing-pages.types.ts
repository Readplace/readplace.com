export type LandingPageSlug =
	| "pocket-alternative"
	| "pdf-ocr"
	| "ai-reading-list"
	| "read-it-later-that-wont-die";

export interface LandingPageActionInput {
	readonly name: string;
	readonly label: string;
	readonly placeholder: string;
}

export interface LandingPageAction {
	readonly key: string;
	readonly label: string;
	readonly href: string;
	readonly input?: LandingPageActionInput;
}

export interface LandingPageStep {
	readonly heading: string;
	readonly body: string;
}

export interface LandingPageFaqEntry {
	readonly question: string;
	readonly answer: string;
}

export interface LandingPageScreenshot {
	/** Resolved against the static asset host at render time, so the same entry
	 * works on localhost and behind the CDN. */
	readonly path: string;
	readonly alt: string;
	readonly caption: string;
	readonly width: number;
	readonly height: number;
}

export interface LandingPageProof {
	readonly title: string;
	readonly screenshot?: LandingPageScreenshot;
	readonly quote?: { readonly text: string; readonly attribution: string };
	readonly founderLine?: string;
}

/**
 * What a reader is asked to pay once the page has convinced them. Three of these
 * pages send a stranger to a destination that eventually asks for a
 * subscription, so the price belongs on the page they saw the ad on rather than
 * as a surprise two clicks later.
 */
export interface LandingPageOffer {
	readonly title: string;
	readonly paragraphs: readonly string[];
	readonly note: string;
}

/**
 * One page's worth of words. Each page owns a file of its own so a copy change
 * for one audience cannot disturb another's, and so the claims on a page sit
 * beside each other where they can be read as a whole — several of them only
 * hold together when the limits list is read with the headline.
 *
 * Every claim was checked against the code that implements it. Read the limits
 * before editing anything above them: obvious-sounding claims (a diff that
 * rejects every altered token, an assistant that can tidy your queue, an export
 * containing your articles, an Export entry in the nav) are contradicted by the
 * implementation.
 *
 * These are paid-ads destinations, so each page also states the price. A reader
 * who arrives from an ad and is asked for money two clicks later was misled by
 * the page, not by the checkout — and on pages selling a product whose whole
 * argument is that it tells you the truth about itself, that would be the one
 * unrecoverable lie. Prices interpolate from the pricing and trial constants so
 * the copy cannot drift away from what the card is actually charged.
 */
export interface LandingPageContent {
	readonly title: string;
	readonly description: string;
	readonly keywords: string;
	readonly headline: string;
	readonly eyebrow: string;
	readonly titleLead: string;
	readonly titleHighlight: string;
	readonly titleTail: string;
	readonly lede: string;
	readonly ogImageAlt: string;
	readonly primaryAction: LandingPageAction;
	readonly secondaryActions: readonly LandingPageAction[];
	readonly reassurance: string;
	readonly stepsTitle: string;
	readonly stepsLede: string;
	readonly steps: readonly LandingPageStep[];
	readonly proof: LandingPageProof;
	readonly mechanismTitle: string;
	readonly mechanismLede: string;
	readonly mechanismParagraphs: readonly string[];
	readonly limitsTitle: string;
	readonly limits: readonly string[];
	readonly faq: readonly LandingPageFaqEntry[];
	readonly offer: LandingPageOffer;
	readonly closeTitle: string;
	/**
	 * The way out for a reader the page convinced but whose hands are in the
	 * wrong place. Three of these pages lead with an action that wants a desktop —
	 * a Pocket export file, an assistant's connector settings, a PDF link to
	 * hand — and the ads pointing at them land mostly on phones. Without this the
	 * page argues someone into wanting the product and then offers them nothing
	 * they can do about it until they are back at a computer.
	 */
	readonly closeSecondaryAction?: LandingPageAction;
	readonly closeNote: string;
}
