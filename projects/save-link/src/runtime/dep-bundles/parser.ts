import type {
	CrawlArticle,
	CrawlFetch,
	ExtractPdf,
} from "@packages/crawl-article";
import {
	initAppleNewsSiteRules,
	initCrawlArticle,
	initCrawlFetch,
	initFetchPinnedCrawl,
	initXTwitterSiteRules,
	CRAWL_PERSONAS,
} from "@packages/crawl-article";
import { isBlockedIpAddress } from "@packages/domain/article";
import {
	initReadabilityParser,
	linkedinSiteRules,
	mediaWikiSiteRules,
	mediumSiteRules,
	theInformationSiteRules,
} from "@packages/article-parser";
import type { ParseHtml } from "@packages/article-parser";
import { initIsSiteRuleUrl } from "../domain/save-link/adopt-canonical-identity";
import type { LogError, LogInfo } from "./observability";

export type ParserDepBundle = {
	crawlFetch: CrawlFetch;
	crawlArticle: CrawlArticle;
	parseHtml: ParseHtml;
	/** Predicate over the crawl-claiming site rules only (oembed replacement,
	 * shell redirect) — NOT the parse-time rules, because `mediumSiteRules.matches`
	 * is deliberately true for every hostname (custom-domain sniffing) and would
	 * make identity adoption refuse every terminal. */
	isSiteRuleUrl: (url: string) => boolean;
};

/**
 * Parser bundle for Lambdas that defer PDF extraction. The `crawlArticle` here
 * is constructed WITHOUT an `extractPdf` dep, so any non-HTML body resolves to
 * `unsupported` and the save-link orchestrator hands the URL to the
 * comprehensive Lambda. The `parseHtml` returned uses this `crawlArticle` for
 * the readability parser's `crawlArticle` dep, which is only exercised by
 * `parseArticle` (test-only) — the production `parseHtml` path receives HTML
 * directly from the caller and never invokes `crawlArticle`. PDF-handling
 * Lambdas should use `initComprehensiveParserDepBundle` instead.
 */
export function initParserDepBundle(deps: {
	logError: LogError;
	logInfo: LogInfo;
	findAdoptedFetchUrl: (url: string) => Promise<string | undefined>;
	proxyUrl: string | undefined;
}): ParserDepBundle {
	const crawlFetch = initCrawlFetch({
		fetch: globalThis.fetch,
		personas: CRAWL_PERSONAS,
		isBlocked: isBlockedIpAddress,
		logInfo: deps.logInfo,
		proxyUrl: deps.proxyUrl,
	});
	const crawlClaimingSiteRules = [
		initXTwitterSiteRules({ crawlFetch, logError: deps.logError }),
		initAppleNewsSiteRules({ crawlFetch, logError: deps.logError }),
	];
	const siteRules = [theInformationSiteRules, mediumSiteRules, linkedinSiteRules, mediaWikiSiteRules, ...crawlClaimingSiteRules];
	const crawlArticle = initFetchPinnedCrawl({
		crawlArticle: initCrawlArticle({ crawlFetch, siteRules, logError: deps.logError, logInfo: deps.logInfo }),
		findAdoptedFetchUrl: deps.findAdoptedFetchUrl,
	});
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		siteRules,
		logError: deps.logError,
	});
	return { crawlFetch, crawlArticle, parseHtml, isSiteRuleUrl: initIsSiteRuleUrl(crawlClaimingSiteRules) };
}

export type ComprehensiveParserDepBundle = {
	crawlFetch: CrawlFetch;
	crawlArticle: CrawlArticle;
	parseHtml: ParseHtml;
	isSiteRuleUrl: (url: string) => boolean;
};

/**
 * Full parser bundle for the comprehensive-crawl Lambda (and stale-check,
 * which still re-extracts PDFs in-process). The `crawlArticle` here is
 * constructed WITH the real `extractPdf`, so it materialises the body once and
 * dispatches HTML to the readability path and PDFs to the extractor in a
 * single fetch.
 */
export function initComprehensiveParserDepBundle(deps: {
	logError: LogError;
	logInfo: LogInfo;
	extractPdf: ExtractPdf;
	findAdoptedFetchUrl: (url: string) => Promise<string | undefined>;
	proxyUrl: string | undefined;
}): ComprehensiveParserDepBundle {
	const crawlFetch = initCrawlFetch({
		fetch: globalThis.fetch,
		personas: CRAWL_PERSONAS,
		isBlocked: isBlockedIpAddress,
		logInfo: deps.logInfo,
		proxyUrl: deps.proxyUrl,
	});
	const crawlClaimingSiteRules = [
		initXTwitterSiteRules({ crawlFetch, logError: deps.logError }),
		initAppleNewsSiteRules({ crawlFetch, logError: deps.logError }),
	];
	const siteRules = [theInformationSiteRules, mediumSiteRules, linkedinSiteRules, mediaWikiSiteRules, ...crawlClaimingSiteRules];
	const crawlArticle = initFetchPinnedCrawl({
		crawlArticle: initCrawlArticle({
			crawlFetch,
			siteRules,
			extractPdf: deps.extractPdf,
			logError: deps.logError,
			logInfo: deps.logInfo,
		}),
		findAdoptedFetchUrl: deps.findAdoptedFetchUrl,
	});
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		siteRules,
		logError: deps.logError,
	});
	return { crawlFetch, crawlArticle, parseHtml, isSiteRuleUrl: initIsSiteRuleUrl(crawlClaimingSiteRules) };
}
