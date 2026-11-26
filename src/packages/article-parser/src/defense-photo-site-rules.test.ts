import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { defensePhotoSiteRules } from "./defense-photo-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const savedUrl = "https://www.defense.gov/Multimedia/Photos/igphoto/1091/?utm_source=feed";
const documentUrl = "https://www.war.gov/Multimedia/Photos/igphoto/1091/";
const media = "https://media.defense.gov/2026/May/03/1091";
const inline = `${media}/840/720/0/example.jpg`;
const original = `${media}/-1/-1/1/example.jpg`;

const html = '<!doctype html><html><head><title>Photo Library</title>' +
	'<meta property="og:url" content="' + documentUrl + '">' +
	'<meta property="og:site_name" content="Public &amp; Records">' +
	'<meta property="og:image" content="' + inline + '"></head><body><main>' +
	'<aside><h1>Photo Library</h1><p>Browse the archive of field photographs and specialist equipment below.</p></aside>' +
	'<article class="image-gallery-detail">' +
	'<a class="details-url" href="' + original + '"><img src="' + inline + '" alt="An annotated bar chart"></a>' +
	'<div class="inner-wrap-narrow"><h1>Harbour Rainfall</h1><p>Monthly rainfall across the coast in millimetres.</p>' +
	'<ul class="meta"><li class="download"><strong>Download:</strong> <a href="' + original + '">Download</a></li>' +
	'<li class="tags"><i></i><strong>Tags:</strong> <a href="/topics/weather">Weather</a></li>' +
	'<li><span><strong>Credit:</strong> Chart Office</span> <span><strong>Asset:</strong> 17</span></li></ul>' +
	'</div></article></main></body></html>';

describe("government photo detail", () => {
	it("projects the credited chart and two published original links from an aliased original", () => {
		const unavailable = () => { throw new Error("Already fetched"); };
		const { siteRules } = initArticleSiteRules({ crawlFetch: unavailable, logError: unavailable });
		const { parseHtml } = initReadabilityParser({ coverageRules: { inspect: () => [] }, crawlArticle: unavailable, siteRules, readabilityAdditions, logError: unavailable });

		const result = parseHtml({ url: savedUrl, documentUrl, html, thumbnailUrl: null });

		assert(result.ok);
		const { document } = parseHTML(result.article.content);
		const figure = document.querySelector("figure");
		assert(figure);
		expect(result.article.title).toBe("Harbour Rainfall");
		expect(result.article.siteName).toBe("Public & Records");
		expect(figure.querySelector("img")?.getAttribute("src")).toBe(inline);
		expect(figure.querySelector("img")?.getAttribute("alt")).toBe("An annotated bar chart");
		expect(figure.querySelector("a")?.getAttribute("href")).toBe(original);
		expect(figure.querySelector("figcaption")?.textContent).toBe("Monthly rainfall across the coast in millimetres.");
		expect([...document.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
			["", original],
			["Download", original],
			["Weather", "https://www.war.gov/topics/weather"],
		]);
		expect([...document.querySelectorAll("strong")].map((label) => label.textContent)).toEqual(["Download:", "Tags:", "Credit:", "Asset:"]);
		expect([...document.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["", "Download: Download", "Tags: Weather", "Credit: Chart Office", "Asset: 17"]);
	});

	it.each([
		["different resolved origin", html, "https://mirror.example/Multimedia/Photos/igphoto/1091/"],
		["different resource on the publisher", html, "https://www.war.gov/News/1091/"],
		["missing source identity", html.replace('property="og:url"', 'property="og:description"'), documentUrl],
		["unrelated photo confirmation", html.replace(documentUrl, documentUrl.replace("1091", "2091")), documentUrl],
		["hidden detail", html.replace('<article class="image-gallery-detail">', '<article class="image-gallery-detail" aria-hidden="true">'), documentUrl],
		["merged credited fields", html.replace("<span><strong>Asset:</strong> 17</span>", ""), documentUrl],
		["missing credited field", html.replace("<strong>Asset:</strong>", "<b>Asset:</b>"), documentUrl],
		["unlabelled credit value", html.replace("Chart Office", ""), documentUrl],
		["missing caption", html.replace("<p>Monthly", "<div>Monthly"), documentUrl],
		["external subject tag", html.replace("/topics/weather", "https://example.org/topics/weather"), documentUrl],
		["missing inline declaration", html.replace('property="og:image"', 'property="og:description"'), documentUrl],
		["foreign inline asset", html.replace('src="https://media.defense.gov/', 'src="https://example.org/'), documentUrl],
		["invalid rendition", html.replace("/840/720/0/", "/-1/720/0/"), documentUrl],
		["missing credit", html.replace("Credit:", "Source:"), documentUrl],
		["different download", html.replace(`href="${original}"`, `href="${inline}"`), documentUrl],
		["different inline asset", html.replace(`src="${inline}"`, `src="${inline.replace("1091", "2091")}"`), documentUrl],
	])("leaves the default parser in charge for %s", (_case, markup, landed) => {
		expect(defensePhotoSiteRules.extract({ html: markup }, { savedUrl, documentUrl: landed })).toBeUndefined();
	});
});
