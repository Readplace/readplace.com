import { noExtract, noRecovery, skipCrawl, type SiteRules } from "@packages/site-rules";

const PUBLISHED_POST = "body > article.elementor-location-single.type-post.status-publish:has(h1) .elementor-widget-theme-post-content:has(p)";
const NEWSLETTER_POPUP = 'body > .sgpb-main-popup-data-container-4441 > .sg-popup-builder-content:has(form#gform_10 input[type="email"])';

export const danaMcNeilSiteRules = {
	matches: ({ hostname }) => hostname === "danamcneil.com",
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: noExtract,
	transform: ({ document }) => {
		if (!document.querySelector(PUBLISHED_POST)) return;
		document.querySelector(NEWSLETTER_POPUP)?.remove();
	},
} satisfies SiteRules;
