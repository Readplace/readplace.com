import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const URL = "https://danamcneil.com/sample-woodshop/";
const TITLE = "How a Handle Fits the Hand";
const FIRST_PARAGRAPH = "The workshop compared two oak handles during the weekly repair session. The longer sample kept the operator's hands farther from the jaws without increasing the force needed to loosen the clamp.";
const LAST_PARAGRAPH = "The next tests will compare the two shapes on a longer project. The team published the measurements so anyone can repeat the exercise on a bench of the same height.";
const QUOTE = "A straight grip made the handle easier to replace, said the workshop supervisor.";
const NEWSLETTER_POPUP = `
	<div class="sgpb-main-popup-data-container-4441" style="position:fixed;opacity:0">
		<div class="sg-popup-builder-content">
			<h2>Subscribe to Workshop Notes</h2>
			${Array.from({ length: 8 }, () => "<p>Get a fresh batch of workshop news and events each month, with advance access to class registration and more updates from our growing network of community repair groups.</p>").join("")}
			<form id="gform_10"><input type="email"><input type="submit" value="Subscribe"></form>
		</div>
	</div>`;

function publishedPost(popup = NEWSLETTER_POPUP): string {
	return `<!DOCTYPE html><html><head>
		<title>${TITLE}</title><meta property="og:title" content="${TITLE}">
	</head><body>
		<article class="elementor-location-single type-post status-publish">
			<header><h1>${TITLE}</h1></header>
			<section><div class="elementor-widget-theme-post-content">
				<p>${FIRST_PARAGRAPH}</p>
				<blockquote><p>${QUOTE}</p></blockquote>
				<figure><iframe src="https://www.youtube.com/embed/seedVideo01"></iframe></figure>
				<p>${LAST_PARAGRAPH} Read the <a href="/sample-measurements/">full notes</a>.</p>
			</div></section>
		</article>
		${popup}
	</body></html>`;
}

const unexpectedIo = () => {
	throw new Error("The publisher rule only uses the supplied HTML");
};
const siteRules = initArticleSiteRules({ crawlFetch: unexpectedIo, logError: unexpectedIo }).siteRules;

function parsePage(params: { html: string; url: string; defaultParser?: boolean }) {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: unexpectedIo,
		logError: unexpectedIo,
		readabilityAdditions,
		siteRules: params.defaultParser ? [] : siteRules,
	});
	const result = parseHtml({ html: params.html, url: params.url, documentUrl: params.url, thumbnailUrl: null });
	assert(result.ok);
	return result.article;
}

describe("Dana McNeil published posts with a newsletter popup", () => {
	it("extracts the published article, its attributed quote, citation and video", () => {
		const article = parsePage({ html: publishedPost(), url: URL });
		const served = sanitizeArticleHtml(article.content);
		const { document } = parseHTML(`<html><body>${served}</body></html>`);
		expect(article.title).toBe(TITLE);
		expect([...document.querySelectorAll("p:not(.reader-embed-facade)")].map((paragraph) => paragraph.textContent?.trim())).toEqual([
			FIRST_PARAGRAPH,
			QUOTE,
			`${LAST_PARAGRAPH} Read the full notes.`,
		]);
		expect(document.querySelector("blockquote")?.textContent?.trim()).toBe(QUOTE);
		expect([...document.querySelectorAll("a[href]")].map((link) => link.getAttribute("href"))).toEqual([
			"https://www.youtube.com/watch?v=seedVideo01",
			"https://danamcneil.com/sample-measurements/",
		]);
		expect(document.querySelector("p.reader-embed-facade img")?.getAttribute("src")).toBe("https://i.ytimg.com/vi/seedVideo01/hqdefault.jpg");
	});

	it.each([
		["another host", publishedPost(), "https://example.com/sample-woodshop/"],
		["an unpublished post", publishedPost().replace("status-publish", "status-private"), URL],
		["an unrecognized post body", publishedPost().replace("elementor-widget-theme-post-content", "other-content-widget"), URL],
		["a different popup", publishedPost().replace("gform_10", "gform_11"), URL],
		["no popup", publishedPost(""), URL],
		["a popup nested in the article", publishedPost("").replace("</article>", `${NEWSLETTER_POPUP}</article>`), URL],
	])("keeps default extraction for %s", (_label, html, url) => {
		expect(parsePage({ html, url })).toEqual(parsePage({ html, url, defaultParser: true }));
	});
});
