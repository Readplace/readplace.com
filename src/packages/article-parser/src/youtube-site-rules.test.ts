import { parseHTML } from "linkedom";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { youtubeSiteRules } from "./youtube-site-rules";

const url = "https://www.youtube.com/watch?v=synthetic123";

function playerHtml(options: {
	videoId?: string;
	status?: string;
	embeddable?: boolean;
	title?: string;
	description?: string;
} = {}): string {
	const player = {
		playabilityStatus: { status: options.status ?? "OK", playableInEmbed: options.embeddable ?? true },
		videoDetails: {
			videoId: options.videoId ?? "synthetic123",
			title: options.title ?? "A useful video",
			shortDescription: options.description ?? "A useful description of the requested video and what it explains.",
		},
	};
	return `<html><body><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script></body></html>`;
}

describe("youtubeSiteRules", () => {
	it("matches supported video hosts without claiming unrelated hosts", () => {
		for (const hostname of ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]) {
			expect(youtubeSiteRules.matches({ url: `https://${hostname}/watch?v=synthetic123`, hostname })).toBe(true);
		}
		expect(youtubeSiteRules.matches({ url: "https://video.example/watch?v=synthetic123", hostname: "video.example" })).toBe(false);
	});

	it("extracts only the requested playable video", () => {
		const extracted = youtubeSiteRules.extract({ url, html: playerHtml() });
		expect(extracted?.title).toBe("A useful video");
		expect(extracted?.bodyHtml).toContain("A useful description");
		expect(extracted?.bodyHtml).toContain("https://www.youtube.com/embed/synthetic123");
		expect(youtubeSiteRules.extract({ url, html: playerHtml({ videoId: "another123" }) })).toBeUndefined();
		expect(youtubeSiteRules.extract({ url, html: playerHtml({ status: "LOGIN_REQUIRED" }) })).toBeUndefined();
		expect(youtubeSiteRules.extract({ url, html: playerHtml({ embeddable: false }) })).toBeUndefined();
	});

	it("fails closed for malformed player JSON, missing identity, and incomplete metadata", () => {
		const malformed = `<html><body><script>var ytInitialPlayerResponse = {"videoDetails":</script></body></html>`;
		expect(youtubeSiteRules.extract({ url, html: malformed })).toBeUndefined();
		expect(youtubeSiteRules.extract({ html: playerHtml() })).toBeUndefined();
		expect(youtubeSiteRules.extract({ url: "https://www.youtube.com/", html: playerHtml() })).toBeUndefined();
		expect(youtubeSiteRules.extract({ url: "https://www.youtube.com/playlist?list=synthetic-list", html: playerHtml() })).toBeUndefined();
		expect(youtubeSiteRules.extract({ url, html: playerHtml({ videoId: "" }) })).toBeUndefined();
		expect(youtubeSiteRules.extract({ url, html: playerHtml({ title: "" }) })).toBeUndefined();
		expect(youtubeSiteRules.extract({ url, html: playerHtml({ description: "" }) })).toBeUndefined();
	});

	it("skips unrelated scripts and preserves JSON strings containing braces, quotes, and backslashes", () => {
		const description = `The example {key: "value"} uses a backslash \\ and explains the requested video.`;
		const first = `<script>var ytInitialPlayerResponse = {"videoDetails":</script>`;
		const valid = playerHtml({ description }).replace("<html><body>", "").replace("</body></html>", "");
		const html = `<html><body>${first}${valid}</body></html>`;
		const extracted = youtubeSiteRules.extract({ url, html });
		const { document } = parseHTML(extracted?.bodyHtml ?? "");
		expect(document.querySelector("p")?.textContent).toBe(description);
	});

	it("skips scripts without an assignment or with balanced invalid JSON before a valid player", () => {
		const unrelated = `<script>const unrelated = {"label":"quoted { text }"};</script>`;
		const invalid = `<script>var ytInitialPlayerResponse = {"videoDetails": nope};</script>`;
		const valid = playerHtml().replace("<html><body>", "").replace("</body></html>", "");
		const extracted = youtubeSiteRules.extract({ url, html: `<html><body>${unrelated}${invalid}${valid}</body></html>` });
		expect(extracted?.title).toBe("A useful video");
		expect(youtubeSiteRules.extract({ url, html: `<html><body>${unrelated}${invalid}</body></html>` })).toBeUndefined();
	});

	it("escapes player text and keeps the existing poster facade through Readability", () => {
		const title = `A <video> & "test"`;
		const description = `A <img src=x onerror="wrong()"> & a long explanation of the requested video, its subject, and why this description should survive extraction.`;
		const html = playerHtml({ title, description });
		const extracted = youtubeSiteRules.extract({ url, html });
		expect(extracted?.bodyHtml).not.toContain("<img src=x");
		expect(extracted?.bodyHtml).toContain("&lt;img");
		const parser = initReadabilityParser({
			crawlArticle: async () => ({ status: "failed" }),
			siteRules: [youtubeSiteRules],
			readabilityAdditions,
			logError: () => {},
		});
		const result = parser.parseHtml({ url, documentUrl: url, html, thumbnailUrl: null });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const { document } = parseHTML(result.article.content);
		expect(result.article.title).toBe(title);
		expect(result.article.content).toContain("&lt;img");
		expect(document.querySelectorAll("script, iframe")).toHaveLength(0);
		expect(document.querySelector(".reader-embed-facade a")?.getAttribute("href")).toBe(url);
		expect(document.querySelector(".reader-embed-facade img")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/synthetic123/hqdefault.jpg");
	});
});
