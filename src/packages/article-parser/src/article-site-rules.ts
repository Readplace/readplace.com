import {
	type CrawlFetch,
	initAppleNewsSiteRules,
	initGitHubPdfSiteRules,
	initFtPartnersTransactionSiteRules,
	initGallupDocumentSiteRules,
	initHnSearchSiteRules,
	initOjsGalleySiteRules,
	initStackOverflowSiteRules,
	initXTwitterSiteRules,
} from "@packages/crawl-article";
import type { SiteRules } from "@packages/site-rules";
import { danaMcNeilSiteRules } from "./dana-mcneil-site-rules";
import { githubPullRequestSiteRules } from "./github-pull-request-site-rules";
import { granolaSiteRules } from "./granola-site-rules";
import { intuitPrivacySiteRules } from "./intuit-privacy-site-rules";
import { linkedinSiteRules } from "./linkedin-site-rules";
import { mediaWikiSiteRules } from "./mediawiki-site-rules";
import { mediumSiteRules } from "./medium-site-rules";
import { quoraSiteRules } from "./quora-site-rules";
import { substackSiteRules } from "./substack-site-rules";
import { theInformationSiteRules } from "./the-information-site-rules";
import { youtubeSiteRules } from "./youtube-site-rules";

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
		initGitHubPdfSiteRules(deps),
		initOjsGalleySiteRules(deps),
		initGallupDocumentSiteRules(deps),
		initFtPartnersTransactionSiteRules(deps),
		initStackOverflowSiteRules(deps),
		initHnSearchSiteRules(deps),
	];
	return {
		siteRules: [theInformationSiteRules, mediumSiteRules, linkedinSiteRules, mediaWikiSiteRules, quoraSiteRules, substackSiteRules, granolaSiteRules, youtubeSiteRules, githubPullRequestSiteRules, danaMcNeilSiteRules, intuitPrivacySiteRules, ...crawlClaimingSiteRules],
		crawlClaimingSiteRules,
	};
}
