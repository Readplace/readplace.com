import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { initYouTubeSiteRules } from "./youtube-site-rules";

const WATCH_URL = "https://www.youtube.com/watch?v=J3PGI4yqta4";
const FIXTURE = readFileSync(join(__dirname, "fixtures", "youtube-watch-J3PGI4yqta4.html"), "utf-8");

const { siteRules } = initArticleSiteRules({
	crawlFetch: async () => new Response("", { status: 404 }),
	logError: () => {},
});

function parserWith(rules: typeof siteRules) {
	return initReadabilityParser({
		coverageRules: { inspect: () => [] },
		siteRules: rules,
		readabilityAdditions,
		logError: () => {},
	});
}

function parseWatchPage(html: string) {
	const result = parserWith(siteRules).parseHtml({ url: WATCH_URL, documentUrl: WATCH_URL, html, thumbnailUrl: null });
	assert(result.ok, "a YouTube watch page parses");
	return result.article;
}

function parseWith(rules: typeof siteRules, html: string) {
	return parserWith(rules).parseHtml({ url: WATCH_URL, documentUrl: WATCH_URL, html, thumbnailUrl: null });
}

function declineOf(html: string) {
	const logged: string[] = [];
	const withRule = parseWith([initYouTubeSiteRules({ logError: (message) => logged.push(message) })], html);
	return { withRule, withoutRule: parseWith([], html), logged };
}

function blocksOf(content: string): Element[] {
	const { document } = parseHTML(`<!DOCTYPE html><html><body>${content}</body></html>`);
	const page = document.querySelector("#readability-page-1");
	assert(page, "Readability wraps its content in #readability-page-1");
	const article = page.querySelector(":scope > article");
	assert(article, "the synthetic page's <article> is the content Readability keeps");
	return Array.from(article.children);
}

function contentDocument(content: string): Document {
	return parseHTML(`<!DOCTYPE html><html><body>${content}</body></html>`).document;
}

function replaceScript(script: string): string {
	return FIXTURE.replace(/<script nonce="fixture">[\s\S]*<\/script>/, script);
}

type CommandRun = { startIndex: number; length: number; onTap: { innertubeCommand: Record<string, unknown> } };

const CHANNEL_OWNER = {
	title: {
		runs: [
			{
				text: "Ryan Carniato",
				navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: "/@ryansolid" } },
			},
		],
	},
};

function watchPageWith(params: {
	description?: { content: string; commandRuns?: CommandRun[] };
	owner?: Record<string, unknown>;
}): Record<string, unknown> {
	return {
		currentVideoEndpoint: { watchEndpoint: { videoId: "J3PGI4yqta4" } },
		contents: {
			twoColumnWatchNextResults: {
				results: {
					results: {
						contents: [
							{
								videoPrimaryInfoRenderer: {
									title: { runs: [{ text: "ReactiveScript: Early Findings" }] },
									dateText: { simpleText: "Streamed live on Nov 6, 2026" },
									viewCount: { videoViewCountRenderer: { viewCount: { simpleText: "7,667 views" } } },
								},
							},
							{
								videoSecondaryInfoRenderer: {
									owner: { videoOwnerRenderer: params.owner ?? CHANNEL_OWNER },
									...(params.description ? { attributedDescription: params.description } : {}),
								},
							},
						],
					},
				},
			},
		},
	};
}

function classicScriptPage(data: Record<string, unknown>): string {
	return replaceScript(`<script nonce="fixture">var ytInitialData = ${JSON.stringify(data)};</script>`);
}

function watchPageWithDescription(description: { content: string; commandRuns?: CommandRun[] }): string {
	return classicScriptPage(watchPageWith({ description }));
}

function chapterRun(params: { startIndex: number; length: number; seconds: number }): CommandRun {
	return {
		startIndex: params.startIndex,
		length: params.length,
		onTap: {
			innertubeCommand:
				params.seconds === 0
					? {
							commandMetadata: { webCommandMetadata: { url: "/watch?v=J3PGI4yqta4" } },
							watchEndpoint: { videoId: "J3PGI4yqta4" },
						}
					: {
							commandMetadata: { webCommandMetadata: { url: `/watch?v=J3PGI4yqta4&t=${params.seconds}s` } },
							watchEndpoint: { videoId: "J3PGI4yqta4", startTimeSeconds: params.seconds },
						},
		},
	};
}

function linkRun(params: { startIndex: number; length: number; url: string }): CommandRun {
	return {
		startIndex: params.startIndex,
		length: params.length,
		onTap: { innertubeCommand: { commandMetadata: { webCommandMetadata: { url: params.url } } } },
	};
}

describe("youtubeSiteRules", () => {
	it("starts a YouTube watch page's body with the video's poster linking to the watch page", () => {
		const [first] = blocksOf(parseWatchPage(FIXTURE).content);

		assert.equal(first.tagName, "P");
		assert.equal(first.getAttribute("class"), "reader-embed-facade");
		const link = first.querySelector("a");
		assert(link, "the poster links to the watch page");
		assert.equal(link.getAttribute("href"), WATCH_URL);
		assert.equal(link.querySelector("img")?.getAttribute("src"), "https://i.ytimg.com/vi/J3PGI4yqta4/hqdefault.jpg");
	});

	it("puts the channel, date and views on one line under the poster", () => {
		const [, second] = blocksOf(parseWatchPage(FIXTURE).content);

		assert.equal(second.tagName, "P");
		assert.equal(second.textContent, "Ryan Carniato · Streamed live on Nov 6, 2026 · 7,667 views");
		assert.equal(second.querySelector("a")?.getAttribute("href"), "https://www.youtube.com/@ryansolid");
	});

	it("titles a YouTube save without the - YouTube suffix", () => {
		assert.equal(parseWatchPage(FIXTURE).title, "ReactiveScript: Early Findings");
	});

	it("keeps YouTube's description as the excerpt", () => {
		assert.match(parseWatchPage(FIXTURE).excerpt, /^What if we had "Rust" for Frontend\?/);
	});

	it("keeps the description's whitespace collapsed as the excerpt", () => {
		const html = watchPageWithDescription({ content: "Line one\nLine two\n\n  Next paragraph  " });

		assert.equal(parseWatchPage(html).excerpt, "Line one Line two Next paragraph");
	});

	it("builds a video with no description from the poster and the channel line only", () => {
		const article = parseWatchPage(classicScriptPage(watchPageWith({})));

		const blocks = blocksOf(article.content);
		assert.equal(blocks.length, 2);
		assert.equal(blocks[0].getAttribute("class"), "reader-embed-facade");
		assert.equal(blocks[1].textContent, "Ryan Carniato · Streamed live on Nov 6, 2026 · 7,667 views");
		assert.equal(article.excerpt, "Content saved from www.youtube.com.");
	});

	it("names a collaboration's channels as plain text on the channel line", () => {
		const html = classicScriptPage(
			watchPageWith({
				description: { content: "A joint stream" },
				owner: { attributedTitle: { content: "A and B" } },
			}),
		);

		const [, second] = blocksOf(parseWatchPage(html).content);

		assert.equal(second.innerHTML, "A and B · Streamed live on Nov 6, 2026 · 7,667 views");
	});

	it("reads ytInitialData from its JSON script element when the page has no classic script", () => {
		const data = watchPageWith({ description: { content: "Line one\nLine two" } });
		const jsonElementPage = replaceScript(
			`<script id="yt-initial-data" type="application/json">${JSON.stringify(data)}</script>`,
		);

		assert.deepEqual(parseWatchPage(jsonElementPage), parseWatchPage(classicScriptPage(data)));
	});

	it("lists chapters as links to their moment in the video", () => {
		const document = contentDocument(parseWatchPage(FIXTURE).content);

		const lists = document.querySelectorAll("ul");
		assert.equal(lists.length, 1);
		const items = Array.from(lists[0].querySelectorAll("li"));
		assert.deepEqual(
			items.map((item) => item.querySelector("a")?.getAttribute("href")),
			[`${WATCH_URL}&t=1s`, `${WATCH_URL}&t=220s`, `${WATCH_URL}&t=452s`],
		);
		assert.equal(items[1].textContent, "00:03:40 - From Runtime Diagnostics to Compiler Checks");
	});

	it("keeps a chapter list whose titles are short", () => {
		const html = watchPageWithDescription({
			content: "0:00 Intro\n1:05 Setup\n2:10 Demo",
			commandRuns: [
				chapterRun({ startIndex: 0, length: 4, seconds: 0 }),
				chapterRun({ startIndex: 11, length: 4, seconds: 65 }),
				chapterRun({ startIndex: 22, length: 4, seconds: 130 }),
			],
		});

		const items = Array.from(contentDocument(parseWatchPage(html).content).querySelectorAll("ul li"));

		assert.deepEqual(
			items.map((item) => item.textContent),
			["0:00 Intro", "1:05 Setup", "2:10 Demo"],
		);
		assert.deepEqual(
			items.map((item) => item.querySelector("a")?.getAttribute("href")),
			[`${WATCH_URL}&t=0s`, `${WATCH_URL}&t=65s`, `${WATCH_URL}&t=130s`],
		);
	});

	it("keeps a timestamp in the middle of a line as an inline link", () => {
		const html = watchPageWithDescription({
			content: "Setup starts at 1:05 today",
			commandRuns: [chapterRun({ startIndex: 16, length: 4, seconds: 65 })],
		});

		const blocks = blocksOf(parseWatchPage(html).content);
		const description = blocks[2];

		assert.equal(blocks.length, 3);
		assert.equal(description.tagName, "P");
		assert.equal(description.textContent, "Setup starts at 1:05 today");
		assert.equal(description.querySelector("a")?.getAttribute("href"), `${WATCH_URL}&t=65s`);
	});

	it("keeps the description's line breaks and paragraphs", () => {
		const html = watchPageWithDescription({ content: "Line one\nLine two\n\nNext paragraph" });

		const blocks = blocksOf(parseWatchPage(html).content);

		assert.deepEqual(
			blocks.slice(2).map((block) => block.outerHTML),
			["<p>Line one<br>Line two</p>", "<p>Next paragraph</p>"],
		);
	});

	it("links a description URL to its target instead of YouTube's redirect", () => {
		const content = "Source: github.com/solidjs/solid";
		const html = watchPageWithDescription({
			content,
			commandRuns: [
				linkRun({
					startIndex: 8,
					length: content.length - 8,
					url: "https://www.youtube.com/redirect?event=video_description&redir_token=X&q=https%3A%2F%2Fgithub.com%2Fsolidjs%2Fsolid&v=J3PGI4yqta4",
				}),
			],
		});

		const link = contentDocument(parseWatchPage(html).content).querySelector('a[href="https://github.com/solidjs/solid"]');

		assert.equal(link?.textContent, "github.com/solidjs/solid");
	});

	it("keeps YouTube's redirect link when it names no target", () => {
		const content = "Source: a link";
		const redirect = "https://www.youtube.com/redirect?event=video_description&redir_token=X";
		const html = watchPageWithDescription({
			content,
			commandRuns: [linkRun({ startIndex: 8, length: 6, url: redirect })],
		});

		const link = contentDocument(parseWatchPage(html).content).querySelector(`a[href="${redirect}"]`);

		assert.equal(link?.textContent, "a link");
	});

	it("resolves a relative YouTube link against youtube.com", () => {
		const content = "Tagged #solidjs";
		const html = watchPageWithDescription({
			content,
			commandRuns: [linkRun({ startIndex: 7, length: 8, url: "/hashtag/solidjs" })],
		});

		const link = contentDocument(parseWatchPage(html).content).querySelector(
			'a[href="https://www.youtube.com/hashtag/solidjs"]',
		);

		assert.equal(link?.textContent, "#solidjs");
	});

	it("falls back to the default parse and logs why when the page has no ytInitialData", () => {
		const { withRule, withoutRule, logged } = declineOf(replaceScript(""));

		assert.deepEqual(withRule, withoutRule);
		assert.deepEqual(logged, [`[YouTubeSiteRule] declined ${WATCH_URL}: no ytInitialData`]);
	});

	it("falls back to the default parse and logs why when ytInitialData is not JSON", () => {
		const { withRule, withoutRule, logged } = declineOf(replaceScript("<script>var ytInitialData = {broken;</script>"));

		assert.deepEqual(withRule, withoutRule);
		assert.deepEqual(logged, [`[YouTubeSiteRule] declined ${WATCH_URL}: ytInitialData is not JSON`]);
	});

	it("falls back to the default parse and logs the first schema issue when ytInitialData lacks the watch-page renderers", () => {
		const { withRule, withoutRule, logged } = declineOf(replaceScript('<script>var ytInitialData = {"contents":{}};</script>'));

		assert.deepEqual(withRule, withoutRule);
		assert.deepEqual(logged, [
			`[YouTubeSiteRule] declined ${WATCH_URL}: currentVideoEndpoint: Invalid input: expected object, received undefined`,
		]);
	});

	it("claims YouTube video URLs only", () => {
		const youtubeSiteRules = initYouTubeSiteRules({ logError: () => {} });
		const matches = (url: string) => youtubeSiteRules.matches({ url, hostname: new URL(url).hostname });

		assert.equal(matches(WATCH_URL), true);
		assert.equal(matches("https://youtu.be/J3PGI4yqta4"), true);
		assert.equal(matches("https://www.youtube.com/playlist?list=PL123"), false);
		assert.equal(matches("https://example.com/watch?v=J3PGI4yqta4"), false);
	});
});
