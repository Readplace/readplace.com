import type {
	ComprehensiveCrawl,
	CrawlFetch,
	ExtractPdf,
	SimpleCrawl,
} from "@packages/crawl-article";
import {
	initComprehensiveCrawl,
	initCrawlArticle,
	initCrawlFetch,
	initSimpleCrawl,
	DEFAULT_CRAWL_HEADERS,
} from "@packages/crawl-article";
import { initReadabilityParser } from "../domain/article-parser/readability-parser";
import { theInformationPreParser } from "../domain/article-parser/the-information-pre-parser";
import { mediumPreParser } from "../domain/article-parser/medium-pre-parser";
import type { ParseHtml } from "../domain/article-parser/article-parser.types";
import type { LogError } from "./observability";

export type ParserDepBundle = {
	crawlFetch: CrawlFetch;
	simpleCrawl: SimpleCrawl;
	comprehensiveCrawl: ComprehensiveCrawl;
	parseHtml: ParseHtml;
};

export function initParserDepBundle(deps: {
	logError: LogError;
	extractPdf: ExtractPdf;
}): ParserDepBundle {
	const crawlFetch = initCrawlFetch({
		fetch: globalThis.fetch,
		defaultHeaders: { ...DEFAULT_CRAWL_HEADERS },
	});
	const simpleCrawl = initSimpleCrawl({ crawlFetch, logError: deps.logError });
	const comprehensiveCrawl = initComprehensiveCrawl({
		crawlFetch,
		extractPdf: deps.extractPdf,
		logError: deps.logError,
	});
	const crawlArticle = initCrawlArticle({ simpleCrawl, comprehensiveCrawl });
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		sitePreParsers: [theInformationPreParser, mediumPreParser],
		logError: deps.logError,
	});
	return { crawlFetch, simpleCrawl, comprehensiveCrawl, parseHtml };
}
