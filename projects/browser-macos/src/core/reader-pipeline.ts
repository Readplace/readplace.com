import {
	initReadabilityParser,
	mediumPreParser,
	type ParseArticleResult,
	theInformationPreParser,
} from "@packages/article-parser";
import {
	CRAWL_PERSONAS,
	initCrawlArticle,
	initCrawlFetch,
} from "@packages/crawl-article";

interface ReaderPipelineDeps {
	fetch: typeof globalThis.fetch;
	logError: (message: string, error?: Error) => void;
}

type LoadArticle = (url: string) => Promise<ParseArticleResult>;

/**
 * Compose Readplace's real reader-view extraction — the crawl fetcher (browser
 * personas, HTTP/2 + curl fallbacks) feeding Mozilla Readability with the same
 * site pre-parsers the production app registers — into a single call that runs
 * entirely in-process. No AWS, no Readplace cloud: this is the whole reader
 * pipeline working offline under the app's own roof.
 */
export function initReaderPipeline(deps: ReaderPipelineDeps): {
	loadArticle: LoadArticle;
} {
	const crawlFetch = initCrawlFetch({
		fetch: deps.fetch,
		personas: CRAWL_PERSONAS,
	});
	const crawlArticle = initCrawlArticle({
		crawlFetch,
		logError: deps.logError,
	});
	const { parseArticle } = initReadabilityParser({
		crawlArticle,
		sitePreParsers: [mediumPreParser, theInformationPreParser],
		logError: deps.logError,
	});
	return { loadArticle: parseArticle };
}
