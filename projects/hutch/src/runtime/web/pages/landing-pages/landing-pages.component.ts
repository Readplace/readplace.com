import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { LANDING_PAGE_CONTENT } from "./landing-pages.content";
import type {
	LandingPageAction,
	LandingPageActionInput,
	LandingPageProof,
	LandingPageSlug,
} from "./landing-pages.content";
import { LANDING_PAGE_STYLES } from "./landing-pages.styles";

const TEMPLATE = readFileSync(join(__dirname, "landing-pages.template.html"), "utf-8");

const ORIGIN = "https://readplace.com";

/** Discarded — only pathname and search are read back off the parsed href. */
const PARSE_ORIGIN = "https://internal.invalid";

type ActionStyle = "btn--on-dark" | "btn--on-dark-ghost" | "btn--primary" | "btn--secondary";

type ActionClass = ActionStyle | `${ActionStyle} btn--field`;

interface HiddenParam {
	readonly name: string;
	readonly value: string;
}

interface RenderedAction {
	readonly key: string;
	readonly label: string;
	readonly action: string;
	readonly hiddenParams: readonly HiddenParam[];
	readonly cssClass: ActionClass;
	readonly formClass: "lp-action" | "lp-action lp-action--field";
	readonly input?: LandingPageActionInput;
}

interface RenderedStep {
	readonly ordinal: number;
	readonly heading: string;
	readonly body: string;
}

/**
 * A GET form, not an anchor, so a CTA that needs a field (paste a PDF link) and
 * one that does not share a single item shape. Browsers discard an action URL's
 * query string on GET submit, so the internal-click UTM params ride as hidden
 * inputs rather than staying on the href.
 */
function renderAction(
	action: LandingPageAction,
	source: string,
	cssClass: ActionStyle,
): RenderedAction {
	const tracked = new URL(
		withInternalTracking(action.href, { source, content: action.key }),
		PARSE_ORIGIN,
	);

	return {
		key: action.key,
		label: action.label,
		cssClass: action.input ? `${cssClass} btn--field` : cssClass,
		input: action.input,
		formClass: action.input ? "lp-action lp-action--field" : "lp-action",
		action: tracked.pathname,
		hiddenParams: Array.from(tracked.searchParams, ([name, value]) => ({ name, value })),
	};
}

/** The screenshot path is stored bare so one entry works on localhost and behind
 * the CDN; only the render knows which host is serving assets. */
function renderProof(proof: LandingPageProof, staticBaseUrl: string) {
	if (!proof.screenshot) {
		return proof;
	}
	return {
		...proof,
		screenshot: { ...proof.screenshot, src: `${staticBaseUrl}${proof.screenshot.path}` },
	};
}

export function LandingPage(params: {
	slug: LandingPageSlug;
	staticBaseUrl: string;
}): PageBody {
	const { slug, staticBaseUrl } = params;
	const page = LANDING_PAGE_CONTENT[slug];

	const heroSource = `lp-${slug}-hero`;
	const heroActions: readonly RenderedAction[] = [
		renderAction(page.primaryAction, heroSource, "btn--on-dark"),
		...page.secondaryActions.map((action) => renderAction(action, heroSource, "btn--on-dark-ghost")),
	];

	const steps: readonly RenderedStep[] = page.steps.map((step, index) => ({
		ordinal: index + 1,
		heading: step.heading,
		body: step.body,
	}));

	const closeSource = `lp-${slug}-close`;
	const closeActions: readonly RenderedAction[] = [
		renderAction(page.primaryAction, closeSource, "btn--primary"),
		...(page.closeSecondaryAction
			? [renderAction(page.closeSecondaryAction, closeSource, "btn--secondary")]
			: []),
	];

	const content = render(TEMPLATE, {
		...page,
		proof: renderProof(page.proof, staticBaseUrl),
		heroActions,
		steps,
		closeActions,
	});

	return {
		seo: {
			title: page.title,
			description: page.description,
			canonicalUrl: `/${slug}`,
			robots: "index, follow",
			keywords: page.keywords,
			ogType: "website",
			ogImage: `${staticBaseUrl}/og-image-1200x630.png`,
			ogImageType: "image/png",
			ogImageAlt: page.ogImageAlt,
			twitterImage: `${staticBaseUrl}/twitter-card-1200x600.png`,
			author: "Fayner Brack",
			structuredData: [
				{
					"@context": "https://schema.org",
					"@type": "WebPage",
					"@id": `${ORIGIN}/${slug}`,
					name: page.headline,
					url: `${ORIGIN}/${slug}`,
					description: page.description,
					isPartOf: { "@type": "WebSite", name: "Readplace", url: ORIGIN },
					about: { "@id": `${ORIGIN}/#app` },
				},
				{
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: page.faq.map((item) => ({
						"@type": "Question",
						name: item.question,
						acceptedAnswer: { "@type": "Answer", text: item.answer },
					})),
				},
			],
		},
		styles: LANDING_PAGE_STYLES,
		/** The hero is the navy gradient, so the header sits on it as the brand
		 * guidelines specify for a landing hero rather than as an opaque bar
		 * stacked above it. */
		headerVariant: "transparent",
		bodyClass: "page-landing",
		content: { html: content },
	};
}
