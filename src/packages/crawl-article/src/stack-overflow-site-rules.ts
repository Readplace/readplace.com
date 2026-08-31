import assert from "node:assert";
import { DOMParser } from "linkedom";
import { noExtract, noRecovery, noTransform } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";
import type { CrawlFetch } from "./crawl-fetch";
import { escapeHtmlText } from "./pdf-html-helpers";

const FETCH_TIMEOUT_MS = 10000;
const STACK_OVERFLOW_HOSTNAMES = new Set(["stackoverflow.com", "www.stackoverflow.com"]);
const QUESTION_PATH = /^\/(?:questions|q)\/(\d+)(?:[/?#]|$)/;
const SITE_NAME = "Stack Overflow";
// the bytes the question page's own og:image serves, on the CDN host that is
// not behind the challenge
const SITE_ICON_URL = "https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon@2.png";

function questionFeedUrl(url: string): string | undefined {
	let target: URL;
	try {
		target = new URL(url);
	} catch {
		return undefined;
	}
	if (!STACK_OVERFLOW_HOSTNAMES.has(target.hostname)) return undefined;
	const questionId = QUESTION_PATH.exec(target.pathname)?.[1];
	if (questionId === undefined) return undefined;
	return `https://stackoverflow.com/feeds/question/${questionId}`;
}

/** The surface this module reads off a linkedom XML node, declared
 * structurally because the package compiles without the DOM lib. */
type FeedElement = {
	readonly localName: string;
	readonly textContent: string;
	readonly children: ArrayLike<FeedElement>;
};

function childElement(parent: FeedElement, name: string): FeedElement | undefined {
	for (const child of Array.from(parent.children)) {
		if (child.localName === name) return child;
	}
	return undefined;
}

function childText(parent: FeedElement, name: string): string {
	const child = childElement(parent, name);
	return child === undefined ? "" : child.textContent;
}

function answerHeading(entry: FeedElement): string {
	const author = childElement(entry, "author");
	const name = author === undefined ? "" : childText(author, "name");
	return name === "" ? "<h2>Answer</h2>" : `<h2>Answer by ${escapeHtmlText(name)}</h2>`;
}

function composeQuestionHtml(feedXml: string): string | undefined {
	const feed = new DOMParser().parseFromString(feedXml, "text/xml");
	const [question, ...answers]: FeedElement[] = Array.from(feed.getElementsByTagName("entry"));
	if (question === undefined) return undefined;
	const title = escapeHtmlText(childText(question, "title"));
	return [
		"<html><head>",
		`<title>${title}</title>`,
		`<meta property="og:site_name" content="${SITE_NAME}">`,
		`<meta property="og:image" content="${SITE_ICON_URL}">`,
		"</head><body><article>",
		`<h1>${title}</h1>`,
		childText(question, "summary"),
		...answers.map((answer) => `${answerHeading(answer)}${childText(answer, "summary")}`),
		"</article></body></html>",
	].join("");
}

/** Cloudflare answers a Stack Overflow question route with a challenge (403,
 * `cf-mitigated: challenge`) to our egress, so the page itself is reachable
 * only through the metered unlocker. The question's Atom feed carries the same
 * question and answer bodies and is served unchallenged, so the article is
 * composed from the feed on a budget too small to arm the proxied pass. It
 * DECLINES rather than failing closed: unlike an oembed shell, the page behind
 * a Stack Overflow URL is the real article, so the fetch cascade — the proxied
 * pass included — stays the floor whenever the feed does not answer. */
export function initStackOverflowSiteRules(deps: {
	crawlFetch: CrawlFetch;
	logError: (message: string, error?: Error) => void;
}): SiteRules {
	const { crawlFetch, logError } = deps;
	const onCrawl: SiteRules["onCrawl"] = async (params) => {
		const feedUrl = questionFeedUrl(params.url);
		assert(feedUrl, "onCrawl only runs for a URL `matches` accepted");
		try {
			const response = await crawlFetch(feedUrl, { budgetMs: FETCH_TIMEOUT_MS });
			if (!response.ok) {
				logError(`[CrawlArticle] question feed HTTP ${response.status} for ${params.url}`);
				return { kind: "skip" };
			}
			const html = composeQuestionHtml(await response.text());
			if (html === undefined) {
				logError(`[CrawlArticle] question feed carries no entry for ${params.url}`);
				return { kind: "skip" };
			}
			return { kind: "content", html };
		} catch (error) {
			logError(
				`[CrawlArticle] question feed error for ${params.url}`,
				error instanceof Error ? error : undefined,
			);
			return { kind: "skip" };
		}
	};

	return {
		matches: ({ url }) => questionFeedUrl(url) !== undefined,
		onCrawl,
		recoverContent: noRecovery,
		extract: noExtract,
		transform: noTransform,
	};
}
