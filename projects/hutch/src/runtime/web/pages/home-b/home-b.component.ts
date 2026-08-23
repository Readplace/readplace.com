import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APPLE_ITUNES_APP_META } from "@packages/supported-clients";
import { CONFIRM_POPOVER_STYLES, render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { SAVE_SURFACE_QUERY, SAVE_SURFACES } from "../../../observability/events";
import type { HomepageVariantMarker } from "../../experiments/homepage-split";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import { buildExtensionDemoVideo } from "../../shared/extension-demo-video";
import { HOME_B_CONTENT } from "./home-b.content";
import { HOME_B_STYLES } from "./home-b.styles";

const TEMPLATE = readFileSync(join(__dirname, "home-b.template.html"), "utf-8");

/** Discarded — only pathname and search are read back off the parsed href. */
const PARSE_ORIGIN = "https://internal.invalid";

const TRACKING_SOURCE = "homepage";

type ActionStyle = "btn--primary" | "btn--secondary";

type ActionClass = ActionStyle | `${ActionStyle} btn--field`;

interface HiddenParam {
	readonly name: string;
	readonly value: string;
}

interface ActionInput {
	readonly name: string;
	readonly label: string;
	readonly placeholder: string;
}

interface RenderedAction {
	readonly key: string;
	readonly label: string;
	readonly action: string;
	readonly hiddenParams: readonly HiddenParam[];
	readonly cssClass: ActionClass;
	readonly input?: ActionInput;
	/** Present on the one action the save tip speaks for, so the client script
	 * can tell it apart from the CTAs it must leave alone. */
	readonly saveTipState?: SaveTipState;
}

interface RenderedLink {
	readonly label: string;
	readonly href: string;
}

interface RenderedJob {
	readonly heading: string;
	readonly body: string;
	readonly links: readonly RenderedLink[];
}

/**
 * A GET form, not an anchor, so a CTA that needs a field (open a link in the
 * reader) and one that does not (start the trial) share one item shape. Browsers
 * drop an action URL's query string on GET submit, so the internal-click UTM
 * params ride as hidden inputs rather than on the href.
 */
function renderAction(input: {
	key: string;
	label: string;
	href: string;
	content: string;
	cssClass: ActionStyle;
	field?: ActionInput;
	saveTipState?: SaveTipState;
}): RenderedAction {
	const tracked = new URL(
		withInternalTracking(input.href, { source: TRACKING_SOURCE, content: input.content }),
		PARSE_ORIGIN,
	);
	return {
		key: input.key,
		label: input.label,
		cssClass: input.field ? `${input.cssClass} btn--field` : input.cssClass,
		input: input.field,
		saveTipState: input.saveTipState,
		action: tracked.pathname,
		hiddenParams: Array.from(tracked.searchParams, ([name, value]) => ({ name, value })),
	};
}

function trackedLink(link: { label: string; href: string; content: string }): RenderedLink {
	return {
		label: link.label,
		href: withInternalTracking(link.href, { source: TRACKING_SOURCE, content: link.content }),
	};
}

export function HomeVariantBPage(params: {
	staticBaseUrl: string;
	variant: HomepageVariantMarker;
	saveTip: SaveTip;
	lastViewUrl?: string;
}): PageBody {
	const { staticBaseUrl, variant, lastViewUrl, saveTip } = params;
	const arrivedFromReader = lastViewUrl !== undefined;
	const { hero, jobs, proof, price, limits, close, faq } = HOME_B_CONTENT;

	const heroPrimary = renderAction({
		key: "hero",
		label: hero.primaryCtaLabel,
		href: "/signup",
		content: "hero",
		cssClass: "btn--primary",
	});

	// The one secondary slot: for a reader-view arrival, save the article they
	// just read (then sign up); otherwise, invite them to open any link in the
	// reader first. Built here so the template renders a single action shape.
	// Narrow on lastViewUrl (not arrivedFromReader) so it is a string in the save branch.
	const heroSecondary: RenderedAction = lastViewUrl !== undefined
		? renderAction({
				key: "hero-save-last-view",
				label: hero.saveLastViewLabel,
				href: `/save?url=${encodeURIComponent(lastViewUrl)}&${SAVE_SURFACE_QUERY}=${SAVE_SURFACES.homepageHero}`,
				content: "hero-save-last-view",
				cssClass: "btn--secondary",
			})
		: renderAction({
				key: "hero-open-reader",
				label: hero.pasteCtaLabel,
				href: "/view",
				content: "hero-open-reader",
				cssClass: "btn--secondary",
				field: {
					name: "url",
					label: hero.pasteInputLabel,
					placeholder: hero.pasteInputPlaceholder,
				},
				saveTipState: saveTip.state,
			});

	const renderedJobs: readonly RenderedJob[] = jobs.items.map((job) => ({
		heading: job.heading,
		body: job.body,
		links: job.links.map(trackedLink),
	}));

	const content = render(TEMPLATE, {
		proofVideo: {
			...buildExtensionDemoVideo("chrome", staticBaseUrl),
			ariaLabel: "Pinning Readplace to the Chrome toolbar, then saving the page in one click",
		},
		saveTipHtml: saveTip.html,
		heroEyebrow: arrivedFromReader ? hero.arrivalEyebrow : undefined,
		heroTitle: hero.title,
		heroSubhead: hero.subhead,
		heroPrimary,
		heroSecondary,
		heroSecondaryLead: arrivedFromReader ? undefined : hero.pasteLead,
		heroReassurance: arrivedFromReader ? hero.reassuranceArrival : hero.reassuranceDefault,
		heroTrialTerms: hero.trialTerms,
		jobsTitle: jobs.title,
		jobsLede: jobs.lede,
		jobs: renderedJobs,
		staticBaseUrl,
		proofTitle: proof.title,
		proofQuote: proof.quote,
		proofAttribution: proof.quoteAttribution,
		proofFounderBody: proof.founderBody,
		proofFounderLink: trackedLink(proof.founderLink),
		proofPrivacyBody: proof.privacyBody,
		proofGithubLink: trackedLink(proof.githubLink),
		priceTitle: price.title,
		priceBody: price.body,
		pricePrimary: renderAction({
			key: "pricing",
			label: hero.primaryCtaLabel,
			href: "/signup",
			content: "pricing",
			cssClass: "btn--primary",
		}),
		priceNote: price.note,
		limitsTitle: limits.title,
		limitsLede: limits.lede,
		limits: limits.items,
		closeTitle: close.title,
		closePrimary: renderAction({
			key: "close",
			label: hero.primaryCtaLabel,
			href: "/signup",
			content: "close",
			cssClass: "btn--primary",
		}),
		closeImportLink: trackedLink(close.importLink),
		closeNote: close.note,
		closeSignoff: close.signoff,
		faq,
	});

	return {
		seo: {
			title: "Readplace — The #1 Personal Reading List | Read It Later",
			description:
				"Readplace is a read-it-later app: save any article, newsletter, or PDF in one click and read it later in a clean reader view with an AI TL;DR. 14-day free trial, no credit card.",
			canonicalUrl: "https://readplace.com",
			ogType: "website",
			robots: "index, follow",
			appleItunesApp: APPLE_ITUNES_APP_META,
			ogImage: `${staticBaseUrl}/og-image-1200x630.png`,
			ogImageType: "image/png",
			ogImageAlt:
				"Readplace logo — A warm, dependable place for your reading list.",
			twitterImage: `${staticBaseUrl}/twitter-card-1200x600.png`,
			author: "Fayner Brack",
		},
		styles: `${HOME_B_STYLES}\n${CONFIRM_POPOVER_STYLES}`,
		bodyClass: `page-home variant-${variant}`,
		content: { html: content },
		scripts: SAVE_TIP_SCRIPT,
	};
}
