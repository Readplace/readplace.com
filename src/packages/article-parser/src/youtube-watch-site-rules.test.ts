import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initReadabilityParser } from "./readability-parser";
import { readabilityAdditions } from "./readability-additions";
import { youTubeWatchSiteRules } from "./youtube-watch-site-rules";

const VIDEO_ID = "syntheticVid01";
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const LATER_WATCH_URL = "https://www.youtube.com/watch?v=syntheticVid02";
const TITLE = "Rebuilding a Toy Loom: Threads and Tension | Wandering Workshop";
const AUTHOR = "Wandering Workshop";
const DESCRIPTION_LINES = [
	"We take apart a tiny wooden loom and string it again from scratch.",
	"",
	"Parts list: {spindle, shuttle, comb} and a lot of patience.",
	'The "tension bar" is the hardest piece to get right.',
	"   ",
	"Thanks for watching and see you in the next build.",
];
const DESCRIPTION = DESCRIPTION_LINES.join("\n");

function playerResponse(videoDetails: Record<string, unknown>): string {
	return JSON.stringify({
		responseContext: { serviceTrackingParams: [{ service: "GFEEDBACK" }] },
		playabilityStatus: { status: "OK" },
		videoDetails,
		microformat: { playerMicroformatRenderer: { title: { simpleText: "unused" } } },
	});
}

function watchPage(playerScript: string): string {
	return `<!DOCTYPE html><html><head><title>${TITLE} - YouTube</title>
<meta property="og:image" content="https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg">
</head><body><div id="player"></div>
<script nonce="abc">var ytcfg = {};</script>
<script nonce="abc">${playerScript}</script>
</body></html>`;
}

function syntheticWatchPage(videoDetails: Record<string, unknown> = {}): string {
	const details = {
		videoId: VIDEO_ID,
		title: TITLE,
		author: AUTHOR,
		shortDescription: DESCRIPTION,
		thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${VIDEO_ID}/default.jpg` }] },
		...videoDetails,
	};
	return watchPage(
		`var ytInitialPlayerResponse = ${playerResponse(details)};var meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'origin-when-cross-origin';`,
	);
}

function tokens(text: string): number {
	return (text.match(/\S+/g) ?? []).length;
}

describe("youTubeWatchSiteRules.matches", () => {
	it.each([
		[WATCH_URL],
		[`${WATCH_URL}&t=95s`],
	])("matches the watch page %s", (url) => {
		expect(youTubeWatchSiteRules.matches({ url, hostname: new URL(url).hostname })).toBe(true);
	});

	it.each([
		["a playlist path", "https://www.youtube.com/playlist?list=PLsynthetic"],
		["the short-link host", `https://youtu.be/${VIDEO_ID}`],
		["the mobile host", `https://m.youtube.com/watch?v=${VIDEO_ID}`],
	])("declines %s", (_label, url) => {
		expect(youTubeWatchSiteRules.matches({ url, hostname: new URL(url).hostname })).toBe(false);
	});
});

describe("youTubeWatchSiteRules.extract", () => {
	it("builds the channel line, one paragraph per non-blank description line and the watch embed", () => {
		const result = youTubeWatchSiteRules.extract({ html: syntheticWatchPage(), url: WATCH_URL });

		expect(result).toEqual({
			title: TITLE,
			bodyHtml: [
				`<p>${AUTHOR}</p>\n`,
				`<p>${DESCRIPTION_LINES[0]}</p>\n`,
				`<p>${DESCRIPTION_LINES[2]}</p>\n`,
				`<p>${DESCRIPTION_LINES[3]}</p>\n`,
				`<p>${DESCRIPTION_LINES[5]}</p>\n`,
				`<iframe src="https://www.youtube.com/embed/${VIDEO_ID}"></iframe>`,
			].join(""),
		});
	});

	it("escapes markup in the player text", () => {
		const result = youTubeWatchSiteRules.extract({ html: syntheticWatchPage({ author: "Loom <b>Lab</b> & Co" }), url: WATCH_URL });

		expect(result?.bodyHtml).toContain("<p>Loom &lt;b&gt;Lab&lt;/b&gt; &amp; Co</p>");
	});

	it.each([
		["a page without player data", watchPage("var ytcfg = {};")],
		["an assignment whose object never closes", watchPage('var ytInitialPlayerResponse = {"videoDetails":{"title":"x"')],
		["an assignment that is not JSON", watchPage("var ytInitialPlayerResponse = {not: json};")],
		["player data without videoDetails", watchPage(`var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status: "OK" } })};`)],
	])("returns undefined for %s", (_label, html) => {
		expect(youTubeWatchSiteRules.extract({ html, url: WATCH_URL })).toBeUndefined();
	});

	it.each([
		["a url naming a different video", LATER_WATCH_URL],
		["a url without a video id", "https://www.youtube.com/watch?feature=share"],
	])("returns undefined for player data read on %s", (_label, url) => {
		expect(youTubeWatchSiteRules.extract({ html: syntheticWatchPage(), url })).toBeUndefined();
	});
});

describe("youTubeWatchSiteRules end-to-end through parseHtml", () => {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => ({ status: "fetched" as const, html: "", bodyHash: "a".repeat(64) }),
		siteRules: [youTubeWatchSiteRules],
		readabilityAdditions,
		logError: () => {},
	});
	const thumbnailUrl = `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`;

	function expectReadableWatchArticle(result: ReturnType<typeof parseHtml>) {
		assert(result.ok);
		expect(result.article.title).toBe(TITLE);
		expect(result.article.wordCount).toBe(tokens(AUTHOR) + tokens(DESCRIPTION));
		expect(result.article.imageUrl).toBe(thumbnailUrl);

		const { document } = parseHTML(`<!DOCTYPE html><html><body>${result.article.content}</body></html>`);
		expect(document.querySelectorAll("iframe")).toHaveLength(0);
		expect(document.querySelectorAll("h1, h2")).toHaveLength(0);
		const paragraphs = Array.from(document.querySelectorAll("p"));
		expect(paragraphs.slice(0, -1).map((paragraph) => paragraph.textContent)).toEqual([
			AUTHOR,
			DESCRIPTION_LINES[0],
			DESCRIPTION_LINES[2],
			DESCRIPTION_LINES[3],
			DESCRIPTION_LINES[5],
		]);
		const poster = paragraphs[paragraphs.length - 1];
		expect(poster.getAttribute("class")).toBe("reader-embed-facade");
		const link = poster.querySelector("a");
		expect(link?.getAttribute("href")).toBe(WATCH_URL);
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
		expect(poster.querySelector("img")?.getAttribute("src")).toBe(`https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`);
	}

	it("turns a watch page into the title, channel, description and poster card", () => {
		expectReadableWatchArticle(
			parseHtml({ url: `${WATCH_URL}&t=95s`, documentUrl: `${WATCH_URL}&t=95s`, html: syntheticWatchPage(), thumbnailUrl }),
		);
	});

	it("reads the watch page a tracking link redirected to", () => {
		expectReadableWatchArticle(
			parseHtml({ url: "https://tracker.example/l/abc", documentUrl: WATCH_URL, html: syntheticWatchPage(), thumbnailUrl }),
		);
	});

	it("parses a capture whose player data describes an earlier video as if no rule matched", () => {
		const { parseHtml: parseWithoutRules } = initReadabilityParser({
			crawlArticle: async () => ({ status: "fetched" as const, html: "", bodyHash: "a".repeat(64) }),
			siteRules: [],
			readabilityAdditions,
			logError: () => {},
		});
		const capture = { url: LATER_WATCH_URL, documentUrl: LATER_WATCH_URL, html: syntheticWatchPage(), thumbnailUrl: null };

		const result = parseHtml(capture);

		expect(result).toEqual(parseWithoutRules(capture));
		assert(result.ok);
		expect(result.article.content).not.toContain(AUTHOR);
	});

	it("keeps the empty fallback for a watch page without player data", () => {
		const result = parseHtml({
			url: WATCH_URL,
			documentUrl: WATCH_URL,
			html: "<html><head><title>Clip - YouTube</title></head><body><script>var ytcfg = {};</script></body></html>",
			thumbnailUrl: null,
		});

		expect(result).toEqual({
			ok: true,
			article: {
				title: "Article from www.youtube.com",
				siteName: "www.youtube.com",
				excerpt: "Content saved from www.youtube.com.",
				wordCount: 0,
				content: "",
				imageUrl: undefined,
			},
		});
	});
});
