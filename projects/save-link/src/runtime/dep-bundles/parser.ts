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
	parseHtml: ParseHtml;
};

/**
 * Simple-only parser bundle for Lambdas that defer PDF extraction. The
 * `parseHtml` returned here uses a stub `crawlArticle` that resolves through
 * the simple-only path — the readability parser's `crawlArticle` dep is only
 * exercised by `parseArticle` (test-only) so the stub is safe for the
 * production code path. PDF-handling Lambdas should use
 * `initComprehensiveParserDepBundle` instead.
 */
export function initParserDepBundle(deps: {
	logError: LogError;
}): ParserDepBundle {
	const crawlFetch = initCrawlFetch({
		fetch: globalThis.fetch,
		defaultHeaders: { ...DEFAULT_CRAWL_HEADERS },
	});
	const simpleCrawl = initSimpleCrawl({ crawlFetch, logError: deps.logError });
	const { parseHtml } = initReadabilityParser({
		// parseArticle (the only crawlArticle consumer in the parser) is only
		// exercised by tests; the production parseHtml path receives HTML
		// directly from the caller and never invokes crawlArticle.
		crawlArticle: simpleCrawl,
		sitePreParsers: [theInformationPreParser, mediumPreParser],
		logError: deps.logError,
	});
	return { crawlFetch, simpleCrawl, parseHtml };
}

export type ComprehensiveParserDepBundle = {
	crawlFetch: CrawlFetch;
	simpleCrawl: SimpleCrawl;
	comprehensiveCrawl: ComprehensiveCrawl;
	parseHtml: ParseHtml;
};

/**
 * Full parser bundle for the comprehensive-crawl Lambda (and stale-check,
 * which still re-extracts PDFs in-process). Includes the PDF-handling
 * `comprehensiveCrawl` and exposes the composed `crawlArticle` on the
 * parser for any caller that needs the full simple+comprehensive
 * fall-through.
 */
export function initComprehensiveParserDepBundle(deps: {
	logError: LogError;
	extractPdf: ExtractPdf;
}): ComprehensiveParserDepBundle {
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
