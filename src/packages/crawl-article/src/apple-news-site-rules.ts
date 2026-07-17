import { noExtract, noTransform } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";
import type { CrawlFetch } from "./crawl-fetch";

const FETCH_TIMEOUT_MS = 10000;
const APPLE_NEWS_HOSTNAMES = new Set(["apple.news", "www.apple.news"]);
/** The shell's inline script navigates via `redirectToUrl("<story url>")` /
 * `redirectToUrlAfterTimeout("<story url>", 0)`. Requiring the opening quote
 * matches only those literal call sites, never the function definitions
 * (`redirectToUrl(url)`) that appear in the same script. */
const STORY_URL_CALL = /redirectToUrl(?:AfterTimeout)?\("([^"]+)"/;

function storyUrlFromShell(html: string): string | undefined {
	const literal = STORY_URL_CALL.exec(html)?.[1];
	if (literal === undefined) return undefined;
	let target: URL;
	try {
		target = new URL(literal);
	} catch {
		return undefined;
	}
	if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
	if (APPLE_NEWS_HOSTNAMES.has(target.hostname)) return undefined;
	/* A bare origin root is never a story: shells for stories without a public
	 * web URL (News-native / News+-only) fill the redirect slot with the
	 * placeholder "http://www.apple.com", and redirecting there would save the
	 * homepage as the story and permanently claim its alias. */
	if (target.pathname === "/" && target.search === "") return undefined;
	return target.href;
}

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
	const onCrawl: SiteRules["onCrawl"] = async (params) => {
		try {
			const response = await crawlFetch(params.url, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
			if (!response.ok) {
				logError(`[CrawlArticle] apple.news shell HTTP ${response.status} for ${params.url}`);
				return { kind: "failed" };
			}
			const storyUrl = storyUrlFromShell(await response.text());
			if (storyUrl === undefined) {
				logError(`[CrawlArticle] apple.news shell carries no story URL for ${params.url}`);
				return { kind: "failed" };
			}
			return { kind: "redirect", url: storyUrl };
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
		extract: noExtract,
		transform: noTransform,
	};
}
