import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { xkcdSiteRules } from "./xkcd-site-rules";

const url = "https://xkcd.com/19990/";
const permalink = "https://xkcd.com/19990";
const sourceImage = "https://imgs.xkcd.com/comics/field_notes.png";
const density = "https://imgs.xkcd.com/comics/field_notes_2x.png";
const hover = "The second label is current only during low tide.";

function source(parts: { density?: boolean; license?: boolean; panelLink?: string } = {}): string {
	const panel = '<img src="' + sourceImage + '" alt="Field Notes" title="' + hover + '"' +
		(parts.density === false ? "" : ' srcset="//imgs.xkcd.com/comics/field_notes_2x.png 2x"') + '>';
	const linked = parts.panelLink === undefined ? panel : `<a${parts.panelLink}>${panel}</a>`;
	const figure = `<div id="comic">${linked}</div>`;
	const license = '<div id="bottom"><div id="licenseText"><p>Published with <a href="https://creativecommons.org/licenses/by-nc/2.5/">a reuse license</a>.</p>' +
		'<p>Read the <a href="/license.html" rel="license">terms</a>.</p></div></div>';
	return '<html><head><meta property="og:url" content="' + url + '"><meta property="og:site_name" content="Notes &amp; Comics"><meta property="og:image" content="' + sourceImage + '"></head>' +
		'<body><div id="middleContainer"><div id="ctitle">Field Notes</div>' + figure +
		'<br>Permanent link to this comic: <a href="' + permalink + '">' + url + '</a>' +
		'<br>Image URL (for hotlinking/embedding): <a href="' + sourceImage + '">' + sourceImage + '</a>' +
		'<div id="transcript" hidden>Unrelated hidden notes.</div></div>' +
		(parts.license === false ? "" : license) + '</body></html>';
}

describe("numbered xkcd comic", () => {
	it("retains the original panel, both image densities, visible hover text, attribution and license", () => {
		const unavailable = () => { throw new Error("Already fetched"); };
		const { siteRules } = initArticleSiteRules({ crawlFetch: unavailable, logError: unavailable });
		const { parseHtml } = initReadabilityParser({ coverageRules: { inspect: () => [] }, siteRules, readabilityAdditions, logError: unavailable });

		const result = parseHtml({ url, documentUrl: url, html: source(), thumbnailUrl: null });

		assert(result.ok);
		const { document } = parseHTML(result.article.content);
		expect(result.article.title).toBe("Field Notes");
		expect(result.article.siteName).toBe("Notes & Comics");
		expect([...document.querySelectorAll("img")].map((image) =>
			[image.getAttribute("src"), image.getAttribute("alt"), image.getAttribute("title"), image.getAttribute("srcset")],
		)).toEqual([[sourceImage, "Field Notes", hover, `${density} 2x`]]);
		expect([...document.querySelectorAll("figcaption")].map((caption) => caption.textContent)).toEqual([hover]);
		expect([...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
			permalink, sourceImage, "https://creativecommons.org/licenses/by-nc/2.5/", "https://xkcd.com/license.html",
		]);
		expect([...document.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
			"", `Permanent link to this comic: ${url}`, `Image URL (for hotlinking/embedding): ${sourceImage}`,
			"Published with a reuse license.", "Read the terms.",
		]);
	});

	it("keeps a disclosed single-size comic without adding unavailable rights or a density", () => {
		const result = xkcdSiteRules.extract({ html: source({ density: false, license: false }) }, { savedUrl: url, documentUrl: url });

		assert(result);
		const document = parseHTML(result.bodyHtml).document;
		expect(document.querySelector("img")?.getAttribute("srcset")).toBeNull();
		expect([...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([permalink, sourceImage]);
	});

	it.each([
		["an absolute", ' href="https://xkcd.com/19990/large/"'],
		["a page-relative", ' href="/19990/large/"'],
	])("keeps the panel inside %s link that wraps it", (_case, panelLink) => {
		const result = xkcdSiteRules.extract({ html: source({ panelLink }) }, { savedUrl: url, documentUrl: url });

		assert(result);
		const document = parseHTML(result.bodyHtml).document;
		const images = [...document.querySelectorAll("img")];
		expect(images.map((image) => [image.getAttribute("src"), image.parentElement?.tagName, image.parentElement?.getAttribute("href")]))
			.toEqual([[sourceImage, "A", "https://xkcd.com/19990/large/"]]);
		expect([...document.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
			"https://xkcd.com/19990/large/", permalink, sourceImage, "https://creativecommons.org/licenses/by-nc/2.5/", "/license.html",
		]);
	});

	it("recognizes the same work when the social card declares its 2× image", () => {
		const markup = source().replace(sourceImage, density);
		const result = xkcdSiteRules.extract({ html: markup }, { savedUrl: url, documentUrl: url });
		assert(result);
		expect(result.title).toBe("Field Notes");
	});

	it.each([
		["missing named publisher", source().replace('property="og:site_name"', 'property="og:description"'), url],
		["archive route", source(), "https://xkcd.com/archive/"],
		["foreign completed URL", source(), "https://example.net/19990/"],
		["another comic", source(), "https://xkcd.com/19991/"],
		["hidden panel", source().replace('id="comic"', 'id="comic" hidden'), url],
		["ambiguous panel", source().replace('</div><br>Permanent', `<img src="${sourceImage}"></div><br>Permanent`), url],
		["ambiguous linked panel", source({ panelLink: ' href="https://xkcd.com/19990/large/"' }).replace('</a></div><br>Permanent', `</a><img src="${sourceImage}"></div><br>Permanent`), url],
		["script panel link", source({ panelLink: ' href="javascript:alert(1)"' }), url],
		["panel link without a destination", source({ panelLink: "" }), url],
		["missing canonical", source().replace('property="og:url"', 'property="og:description"'), url],
		["unrelated high-density asset", source().replace("field_notes_2x.png", "other_2x.png"), url],
		["unrelated publisher social image", source().replace(sourceImage, "https://imgs.xkcd.com/comics/calendar.png"), url],
		["third-party social image", source().replace(sourceImage, "https://example.org/figure.png"), url],
		["wrong permalink", source().replace(`href="${permalink}"`, 'href="/19991/"'), url],
		["missing work label", source().replace("Permanent link to this comic: ", ""), url],
		["missing image label", source().replace("Image URL (for hotlinking/embedding): ", ""), url],
		["missing visible work URL", source().replace(`>${url}</a>`, "></a>"), url],
		["wrong visible work URL", source().replace(`>${url}</a>`, ">https://xkcd.com/19991/</a>"), url],
		["missing visible image URL", source().replace(`>${sourceImage}</a>`, "></a>"), url],
		["wrong visible image URL", source().replace(`>${sourceImage}</a>`, ">https://example.net/field.png</a>"), url],
	])("lets the ordinary parser handle %s", (_case, html, landed) => {
		expect(xkcdSiteRules.extract({ html }, { savedUrl: url, documentUrl: landed })).toBeUndefined();
	});
});
