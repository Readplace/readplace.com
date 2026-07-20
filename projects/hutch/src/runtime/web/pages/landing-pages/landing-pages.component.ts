import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { LANDING_PAGE_CONTENT } from "./landing-pages.content";
import type { LandingPageAction, LandingPageActionInput, LandingPageSlug } from "./landing-pages.content";
import { LANDING_PAGE_STYLES } from "./landing-pages.styles";

const TEMPLATE = readFileSync(join(__dirname, "landing-pages.template.html"), "utf-8");

const ORIGIN = "https://readplace.com";

/** Discarded — only pathname and search are read back off the parsed href. */
const PARSE_ORIGIN = "https://internal.invalid";

type ActionStyle = "lp-btn--on-dark" | "lp-btn--ghost" | "lp-btn--brand";

interface HiddenParam {
	readonly name: string;
	readonly value: string;
}

interface RenderedAction {
	readonly key: string;
	readonly label: string;
	readonly action: string;
	readonly hiddenParams: readonly HiddenParam[];
	readonly cssClass: ActionStyle;
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
		cssClass,
		input: action.input,
		formClass: action.input ? "lp-action lp-action--field" : "lp-action",
		action: tracked.pathname,
		hiddenParams: Array.from(tracked.searchParams, ([name, value]) => ({ name, value })),
	};
}

export function LandingPage(slug: LandingPageSlug): PageBody {
	const page = LANDING_PAGE_CONTENT[slug];

	const heroSource = `lp-${slug}-hero`;
	const heroActions: readonly RenderedAction[] = [
		renderAction(page.primaryAction, heroSource, "lp-btn--on-dark"),
		...page.secondaryActions.map((action) => renderAction(action, heroSource, "lp-btn--ghost")),
	];

	const steps: readonly RenderedStep[] = page.steps.map((step, index) => ({
		ordinal: index + 1,
		heading: step.heading,
		body: step.body,
	}));

	const content = render(TEMPLATE, {
		...page,
		heroActions,
		steps,
		closeActions: [renderAction(page.primaryAction, `lp-${slug}-close`, "lp-btn--brand")],
	});

	return {
		seo: {
			title: page.title,
			description: page.description,
			canonicalUrl: `/${slug}`,
			robots: "index, follow",
			keywords: page.keywords,
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
		bodyClass: "page-landing",
		content: { html: content },
	};
}
