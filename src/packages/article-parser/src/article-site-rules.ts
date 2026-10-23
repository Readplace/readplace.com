import {
	type CrawlFetch,
	initAppleNewsSiteRules,
	initHnSearchSiteRules,
	initStackOverflowSiteRules,
	initXTwitterSiteRules,
} from "@packages/crawl-article";
import type { SiteRules } from "@packages/site-rules";
import { linkedinSiteRules } from "./linkedin-site-rules";
import { mediaWikiSiteRules } from "./mediawiki-site-rules";
import { mediumSiteRules } from "./medium-site-rules";
import { slideshareSiteRules } from "./slideshare-site-rules";
import { substackSiteRules } from "./substack-site-rules";
import { theInformationSiteRules } from "./the-information-site-rules";

export type ArticleSiteRules = {
	siteRules: readonly SiteRules[];
	crawlClaimingSiteRules: readonly SiteRules[];
};

export function initArticleSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): ArticleSiteRules {
	const crawlClaimingSiteRules = [
		initXTwitterSiteRules(deps),
		initAppleNewsSiteRules(deps),
		initStackOverflowSiteRules(deps),
		initHnSearchSiteRules(deps),
	];
	return {
		siteRules: [theInformationSiteRules, mediumSiteRules, linkedinSiteRules, mediaWikiSiteRules, substackSiteRules, slideshareSiteRules, ...crawlClaimingSiteRules],
		crawlClaimingSiteRules,
	};
}
