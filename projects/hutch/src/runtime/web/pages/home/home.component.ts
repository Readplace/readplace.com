import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIRM_POPOVER_STYLES,
	PRICING_PANELS,
	render,
	withInternalTracking,
} from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { ADVERTISED_CLIENTS } from "@packages/supported-clients";

import { SAVE_SURFACE_QUERY, SAVE_SURFACES } from "../../../observability/events";
import { AI_ASSISTANTS_OR } from "../../shared/client-enumerations";
import { buildExtensionDemoVideo } from "../../shared/extension-demo-video";
import {
	PAGE_DEPTH_SCRIPT,
	renderPageDepthBeacon,
} from "../../shared/page-depth/page-depth.component";
import type { SaveTipState } from "../../shared/save-tip/save-tip";
import { SAVE_TIP_SCRIPT, type SaveTip } from "../../shared/save-tip/save-tip.component";
import {
	HOME_BROWSER_EXTENSION_ROW,
	HOME_CONTENT,
	HOME_NATIVE_APP_ROW_BY_CLIENT,
	HOME_WAY_LINK_BY_CLIENT,
	HOME_WAYS_WITHOUT_A_CLIENT,
	type HomeWayLink,
	type HomeWayRow,
} from "./home.content";
import { buildHomeSeo } from "./home.seo";
import { HOME_PAGE_STYLES } from "./home.styles";

const HOME_TEMPLATE = readFileSync(join(__dirname, "home.template.html"), "utf-8");

/** Discarded — only the pathname and search are read back off the parsed href. */
const PARSE_ORIGIN = "https://internal.invalid";

const TRACKING_SOURCE = "homepage";

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
	readonly cssClass: string;
	readonly input?: ActionInput;
	readonly saveTipState?: SaveTipState;
	readonly lead?: string;
	/** What the action would act on, named and linked so a reader who left the
	 * article minutes ago can tell which one this saves — and reopen it. */
	readonly target?: RenderedLink;
}

interface RenderedLink {
	readonly label: string;
	readonly href: string;
}

/**
 * A GET form, not an anchor, so an action that needs a field (open a link in the
 * reader) and one that does not (save the article just read) share one item
 * shape. Browsers drop an action URL's query string on GET submit, so the
 * internal-click UTM params ride as hidden inputs rather than on the href.
 */
function renderAction(input: {
	key: string;
	label: string;
	href: string;
	content: string;
	cssClass: string;
	field?: ActionInput;
	saveTipState?: SaveTipState;
	lead?: string;
	target?: RenderedLink;
}): RenderedAction {
	const tracked = new URL(
		withInternalTracking(input.href, { source: TRACKING_SOURCE, content: input.content }),
		PARSE_ORIGIN,
	);
	return {
		key: input.key,
		label: input.label,
		cssClass: input.cssClass,
		input: input.field,
		saveTipState: input.saveTipState,
		lead: input.lead,
		target: input.target,
		action: tracked.pathname,
		hiddenParams: Array.from(tracked.searchParams, ([name, value]) => ({ name, value })),
	};
}

function trackedLink(link: {
	label: string;
	href: string;
	content: string;
	source: string;
}): RenderedLink {
	return {
		label: link.label,
		href: withInternalTracking(link.href, { source: link.source, content: link.content }),
	};
}

const { hero, ways, assistant, proof, principle, pricing, faq, close } = HOME_CONTENT;

function byOrder(left: HomeWayLink, right: HomeWayLink): number {
	return left.order - right.order;
}

/**
 * The save routes that get a row: the advertised browser extensions merged into
 * one row, one row per advertised phone app, then the ways in that have no
 * client behind them. An assistant saves a bare URL and gets its own section
 * instead, and a client nobody can install yet is not offered here at all —
 * every map indexed below is keyed by an advertised-only union, so this
 * assembly cannot reach for one.
 */
const HOMEPAGE_WAYS: readonly HomeWayRow[] = [
	{
		...HOME_BROWSER_EXTENSION_ROW,
		links: ADVERTISED_CLIENTS.flatMap((client) =>
			client.group === "browserExtension" ? [HOME_WAY_LINK_BY_CLIENT[client.name]] : [],
		)
			.slice()
			.sort(byOrder),
	},
	...ADVERTISED_CLIENTS.flatMap((client) =>
		client.group === "nativeApp"
			? [
					{
						...HOME_NATIVE_APP_ROW_BY_CLIENT[client.name],
						links: [HOME_WAY_LINK_BY_CLIENT[client.name]],
					},
				]
			: [],
	),
	...HOME_WAYS_WITHOUT_A_CLIENT,
];

const HOMEPAGE_PRICING_PANELS = PRICING_PANELS.map((panel) => {
	const emphasis = panel.featured
		? {
				panelClass: "home-pricing__plan home-pricing__plan--featured",
				buttonVariant: "btn--primary",
			}
		: { panelClass: "home-pricing__plan", buttonVariant: "btn--secondary" };
	return {
		tierId: panel.key,
		name: panel.name,
		monthlyDisplay: panel.monthlyDisplay,
		billedNote: panel.billedNote,
		badge: panel.badge,
		panelClass: emphasis.panelClass,
		cta: renderAction({
			key: `plan-${panel.key}`,
			label: pricing.panelCtaLabel,
			href: "/signup",
			content: `plan-${panel.key}`,
			cssClass: `${emphasis.buttonVariant} home-pricing__plan-button`,
		}),
	};
});
function buildPasteAction(input: { primary: boolean; saveTipState: SaveTipState }): RenderedAction {
	return renderAction({
		key: "homepage-link-input",
		label: hero.pasteCtaLabel,
		href: "/view",
		content: "homepage-link-input",
		cssClass: input.primary ? "btn--on-dark btn--field" : "btn--on-dark-ghost btn--field",
		field: { name: "url", label: hero.pasteLabel, placeholder: hero.pastePlaceholder },
		saveTipState: input.saveTipState,
		lead: input.primary ? undefined : hero.saveLastViewLead,
	});
}

interface ArrivalArticle {
	readonly host: string;
	readonly display: string;
}

/** The cookie holds whatever was written to it, so a value that is not a URL
 * leaves the action unnamed rather than throwing on the homepage render. */
function describeArrivalArticle(url: string): ArrivalArticle | undefined {
	const parsed = URL.parse(url);
	if (parsed === null) return undefined;
	const host = parsed.host.replace(/^www\./, "");
	const path = `${parsed.pathname}${parsed.search}`.replace(/\/$/, "");
	return { host, display: `${host}${path}` };
}

/**
 * A reader-view arrival is offered the article they just read before anything
 * else, with the paste box demoted rather than replaced so they can still open
 * another link without leaving the hero.
 *
 * The action names the article: both readers who ever clicked its unnamed
 * predecessor had left the page minutes earlier, so the button has to say what
 * it would save rather than assume they still remember.
 */
function buildHeroActions(input: {
	lastViewUrl: string | undefined;
	saveTipState: SaveTipState;
}): readonly RenderedAction[] {
	if (input.lastViewUrl === undefined) {
		return [buildPasteAction({ primary: true, saveTipState: input.saveTipState })];
	}
	const article = describeArrivalArticle(input.lastViewUrl);
	const target =
		article === undefined
			? undefined
			: {
					label: article.display,
					href: withInternalTracking(`/view?url=${encodeURIComponent(input.lastViewUrl)}`, {
						source: TRACKING_SOURCE,
						content: "hero-last-view-article",
					}),
				};
	const saveLastView = renderAction({
		key: "hero-save-last-view",
		label:
			article === undefined
				? hero.saveLastViewFallbackLabel
				: hero.saveLastViewLabel.replace("{host}", article.host),
		href: `/save?url=${encodeURIComponent(input.lastViewUrl)}&${SAVE_SURFACE_QUERY}=${SAVE_SURFACES.homepageHero}`,
		content: "hero-save-last-view",
		cssClass: "btn--on-dark",
		target,
	});
	return [saveLastView, buildPasteAction({ primary: false, saveTipState: input.saveTipState })];
}

export function HomePage(params: {
	staticBaseUrl: string;
	saveTip: SaveTip;
	lastViewUrl: string | undefined;
}): PageBody {
	const { staticBaseUrl, saveTip, lastViewUrl } = params;

	return {
		seo: buildHomeSeo({ staticBaseUrl, faq: faq.items }),
		styles: `${HOME_PAGE_STYLES}\n${CONFIRM_POPOVER_STYLES}`,
		scripts: `${SAVE_TIP_SCRIPT}${PAGE_DEPTH_SCRIPT}`,
		bodyClass: "page-home",
		content: {
			html: render(HOME_TEMPLATE, {
				saveTipHtml: saveTip.html,
				pageDepthBeacon: renderPageDepthBeacon(),
				heroEyebrow: lastViewUrl === undefined ? undefined : hero.arrivalEyebrow,
				heroTitle: hero.title,
				heroSubhead: hero.subhead,
				heroActions: buildHeroActions({ lastViewUrl, saveTipState: saveTip.state }),
				heroReassurance: hero.reassurance,
				waysTitle: ways.title,
				ways: HOMEPAGE_WAYS.map((way) => ({
					name: way.name,
					bodyLead: way.bodyLead,
					bodyIcon: way.bodyIcon,
					bodyMid: way.bodyMid,
					bodyLink:
						way.bodyLink === undefined
							? undefined
							: trackedLink({ ...way.bodyLink, content: way.bodyLink.trackContent, source: "home-ways" }),
					examples: way.examples,
					bodyTail: way.bodyTail,
					links: way.links.map((link) => ({
						label: link.label,
						href: withInternalTracking(link.href, {
							source: "home-ways",
							content: link.trackContent,
						}),
					})),
				})),
				waysNoteLead: ways.noteLead,
				waysNoteLink: trackedLink({ ...ways.noteLink, source: "home-ways" }),
				assistantTitle: assistant.title,
				assistantBodyLead: assistant.bodyLead,
				assistantNames: AI_ASSISTANTS_OR,
				assistantBodyTail: assistant.bodyTail,
				assistantLink: trackedLink({
					label: assistant.linkLabel,
					href: assistant.linkHref,
					content: assistant.trackContent,
					source: "home-assistant",
				}),
				proofTitle: proof.title,
				proofVideo: {
					...buildExtensionDemoVideo("chrome", staticBaseUrl),
					ariaLabel: proof.videoAriaLabel,
				},
				proofQuote: proof.quote,
				proofAttribution: proof.quoteAttribution,
				proofFounderLead: proof.founderLead,
				proofJsCookieLink: proof.founderJsCookieLink,
				proofFounderMid: proof.founderMid,
				proofFounderLink: trackedLink({ ...proof.founderLink, source: "home-proof" }),
				proofFounderClose: proof.founderClose,
				principleTitle: principle.title,
				principleAvatarUrl: `${staticBaseUrl}/fayner-brack.jpg`,
				principleAvatarAlt: principle.avatarAlt,
				principleBody: principle.body,
				pricingTitleBefore: pricing.titleBefore,
				pricingPriceAmount: pricing.priceAmount,
				pricingTitleAfter: pricing.titleAfter,
				pricingPanels: HOMEPAGE_PRICING_PANELS,
				pricingNote: pricing.ctaNote,
				pricingAssurances: pricing.assurances,
				pricingSourceLead: pricing.sourceLead,
				pricingSourceLink: pricing.sourceLink,
				pricingSourceClose: pricing.sourceClose,
				faqTitle: faq.title,
				faq: faq.items,
				closeTitle: close.title,
				closeInstallLink: trackedLink({
					label: close.installLabel,
					href: close.installHref,
					content: "install",
					source: "home-close",
				}),
				closeImportLink: trackedLink({
					label: close.importLabel,
					href: close.importHref,
					content: "import",
					source: "home-close",
				}),
				closeSignoff: close.signoff,
			}),
		},
	};
}
