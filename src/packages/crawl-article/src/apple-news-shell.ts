import type { CrawlFetch } from "./crawl-fetch";

const FETCH_TIMEOUT_MS = 10000;
export const APPLE_NEWS_HOSTNAMES: ReadonlySet<string> = new Set(["apple.news", "www.apple.news"]);
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

type AppleNewsShell =
	| { kind: "story"; url: string }
	| { kind: "no-story-url" }
	| { kind: "unavailable"; status: number };

export type FetchAppleNewsShell = (url: string, init?: { signal?: AbortSignal }) => Promise<AppleNewsShell>;

export function initFetchAppleNewsShell(deps: { crawlFetch: CrawlFetch }): FetchAppleNewsShell {
	return async (url, init) => {
		const response = await deps.crawlFetch(url, { budgetMs: FETCH_TIMEOUT_MS, signal: init?.signal });
		if (!response.ok) return { kind: "unavailable", status: response.status };
		const storyUrl = storyUrlFromShell(await response.text());
		if (storyUrl === undefined) return { kind: "no-story-url" };
		return { kind: "story", url: storyUrl };
	};
}

export type ResolveAppleNewsStoryUrl = (url: string, init: { signal: AbortSignal }) => Promise<AppleNewsShell>;

export function initResolveAppleNewsStoryUrl(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): ResolveAppleNewsStoryUrl {
	const fetchShell = initFetchAppleNewsShell({ crawlFetch: deps.crawlFetch });
	return async (url, init) => {
		const shell = await fetchShell(url, init);
		if (shell.kind === "unavailable") {
			deps.logError(`[CrawlArticle] apple.news shell HTTP ${shell.status} for ${url}`);
		}
		return shell;
	};
}
