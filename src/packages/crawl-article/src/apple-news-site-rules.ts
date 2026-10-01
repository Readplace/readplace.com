import { noExtract, noTransform } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";
import type { CrawlFetch } from "./crawl-fetch";
import { initFetchAnfArticle } from "./apple-news-anf";
import { APPLE_NEWS_HOSTNAMES, initFetchAppleNewsShell } from "./apple-news-shell";

/** An apple.news share link answers 200 with a static shell ("Opening
 * story…") that client-side-redirects to the publisher's canonical URL, so a
 * normal fetch only captures the shell. This site fetches the shell, extracts
 * the story URL embedded in it, and redirects the crawl there — the publisher
 * URL then becomes the redirect terminal, so identity adoption shows and
 * re-crawls the real article. It fails closed when no story URL is embedded
 * (channel/topic links, News+-only stories) rather than declining, so the
 * caller never falls back to saving the shell. */
export function initAppleNewsSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	const { crawlFetch, logError } = deps;
	const fetchAnfArticle = initFetchAnfArticle({ crawlFetch, logError });
	const fetchShell = initFetchAppleNewsShell({ crawlFetch });

	const onCrawl: SiteRules["onCrawl"] = async (params) => {
		try {
			const shell = await fetchShell(params.url);
			if (shell.kind === "unavailable") {
				logError(`[CrawlArticle] apple.news shell HTTP ${shell.status} for ${params.url}`);
				return { kind: "failed" };
			}
			if (shell.kind === "story") return { kind: "redirect", url: shell.url };
			const html = await fetchAnfArticle({ url: params.url });
			if (html !== undefined) return { kind: "content", html };
			logError(`[CrawlArticle] apple.news shell carries no story URL for ${params.url}`);
			return { kind: "failed" };
		} catch (error) {
			logError(
				`[CrawlArticle] apple.news shell fetch error for ${params.url}`,
				error instanceof Error ? error : undefined,
			);
			return { kind: "failed" };
		}
	};

	return {
		matches: ({ hostname }) => APPLE_NEWS_HOSTNAMES.has(hostname),
		onCrawl,
		recoverContent: ({ url }) => fetchAnfArticle({ url }),
		extract: noExtract,
		transform: noTransform,
	};
}
