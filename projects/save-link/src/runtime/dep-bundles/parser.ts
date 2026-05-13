import { initCrawlArticle, initCrawlFetch, DEFAULT_CRAWL_HEADERS } from "@packages/crawl-article";
import type { CrawlArticle, CrawlFetch } from "@packages/crawl-article";
import { initReadabilityParser } from "../domain/article-parser/readability-parser";
import { theInformationPreParser } from "../domain/article-parser/the-information-pre-parser";
import type { ParseHtml } from "../domain/article-parser/article-parser.types";
import type { LogError } from "./observability";

export type ParserDepBundle = {
	crawlFetch: CrawlFetch;
	crawlArticle: CrawlArticle;
	parseHtml: ParseHtml;
};

export function initParserDepBundle(deps: { logError: LogError }): ParserDepBundle {
	const crawlFetch = initCrawlFetch({
		fetch: globalThis.fetch,
		defaultHeaders: { ...DEFAULT_CRAWL_HEADERS },
	});
	const crawlArticle = initCrawlArticle({ crawlFetch, logError: deps.logError });
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		sitePreParsers: [theInformationPreParser],
		logError: deps.logError,
	});
	return { crawlFetch, crawlArticle, parseHtml };
}
