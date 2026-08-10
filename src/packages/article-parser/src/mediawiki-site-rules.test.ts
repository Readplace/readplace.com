import { parseHTML } from "linkedom";
import { mediaWikiSiteRules } from "./mediawiki-site-rules";
import { initReadabilityParser } from "./readability-parser";

/* A Vector-2022 section heading: an <h2> and its "[edit]" chrome wrapped in one
 * `.mw-heading` div — the shape whose link density makes Readability drop the
 * whole wrapper (heading included). */
const MW_HEADING =
	'<div class="mw-heading mw-heading2"><h2 id="s2">Ideas presented</h2>' +
	'<span class="mw-editsection"><span>[</span>' +
	'<a href="/w/index.php?title=X&amp;action=edit&amp;section=2">edit</a>' +
	"<span>]</span></span></div>";

/* Parse a body fragment under an optional generator meta, run the in-place
 * transform, and return the body HTML before and after. No-op cases assert
 * `after === before`. */
function runTransform(params: {
	bodyHtml: string;
	generator?: string;
}): { before: string; after: string } {
	const meta = params.generator
		? `<meta name="generator" content="${params.generator}">`
		: "";
	const { document } = parseHTML(
		`<!DOCTYPE html><html><head>${meta}</head><body>${params.bodyHtml}</body></html>`,
	);
	const before = document.body.innerHTML;
	mediaWikiSiteRules.transform({ document });
	return { before, after: document.body.innerHTML };
}

describe("mediaWikiSiteRules.matches", () => {
	it("matches every hostname — the MediaWiki fingerprint gate lives in transform", () => {
		expect(
			mediaWikiSiteRules.matches({
				url: "https://en.wikipedia.org/wiki/Reading",
				hostname: "en.wikipedia.org",
			}),
		).toBe(true);
		expect(
			mediaWikiSiteRules.matches({
				url: "https://example.com/x",
				hostname: "example.com",
			}),
		).toBe(true);
	});
});

describe("mediaWikiSiteRules.transform", () => {
	it("strips the .mw-editsection chrome from a MediaWiki heading, keeping the <h2>", () => {
		const { after } = runTransform({
			bodyHtml: MW_HEADING,
			generator: "MediaWiki 1.47.0-wmf.11",
		});
		expect(after).toContain("<h2");
		expect(after).toContain("Ideas presented");
		expect(after).not.toContain("mw-editsection");
		expect(after).not.toContain(">edit<");
	});

	it("strips the chrome without a generator meta — Parsoid read views omit it", () => {
		const { after } = runTransform({ bodyHtml: MW_HEADING });
		expect(after).toContain("<h2");
		expect(after).toContain("Ideas presented");
		expect(after).not.toContain("mw-editsection");
	});

	it("leaves a document with no .mw-editsection elements untouched", () => {
		const { before, after } = runTransform({
			bodyHtml: "<article><h2>Plain heading</h2><p>Plain body.</p></article>",
		});
		expect(after).toBe(before);
	});
});

/* A MediaWiki article whose section headings Readability drops without the
 * transform: each heading's `.mw-editsection` link makes Readability score the
 * `.mw-heading` wrapper as removable chrome and delete it (heading included).
 * Verified against @mozilla/readability 0.6.0. */
const BODY_PARAGRAPH =
	"Fred Brooks argues that adding manpower to a late software project makes " +
	"it later, a claim now known as Brooks's law and repeated across the " +
	"software industry for decades since its first publication. ".repeat(3);

function mediaWikiArticle(): string {
	const section = (n: number, title: string) =>
		`<div class="mw-heading mw-heading2"><h2 id="s${n}">${title}</h2>` +
		`<span class="mw-editsection"><span>[</span>` +
		`<a href="/w/index.php?title=X&amp;action=edit&amp;section=${n}">edit</a>` +
		`<span>]</span></span></div><p>${BODY_PARAGRAPH}</p><p>${BODY_PARAGRAPH}</p>`;
	return (
		"<!DOCTYPE html><html>" +
		'<head><meta name="generator" content="MediaWiki 1.47.0-wmf.11">' +
		"<title>The Mythical Man-Month - Wikipedia</title></head>" +
		'<body><div id="content"><div class="mw-parser-output">' +
		`<p>${BODY_PARAGRAPH}</p>` +
		section(2, "Ideas presented") +
		section(3, "No silver bullet") +
		section(4, "Reception") +
		"</div></div></body></html>"
	);
}

describe("mediaWikiSiteRules end-to-end through parseHtml", () => {
	const parser = (siteRules: Parameters<typeof initReadabilityParser>[0]["siteRules"]) =>
		initReadabilityParser({
			crawlArticle: async () => ({
				status: "fetched" as const,
				html: "",
				bodyHash: "a".repeat(64),
			}),
			siteRules,
			logError: () => {},
		});

	it("keeps the section headings Readability would otherwise drop, with no [edit] chrome", () => {
		const { parseHtml } = parser([mediaWikiSiteRules]);
		const result = parseHtml({
			url: "https://en.wikipedia.org/wiki/The_Mythical_Man-Month",
			html: mediaWikiArticle(),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const content = result.article.content;
		expect(content).toContain("Ideas presented");
		expect(content).toContain("Reception");
		expect(content).not.toContain(">edit<");
	});

	/* The 2026-08-09 Tier 1+ canary failure: Wikimedia's Parsoid read view (an
	 * anonymous-traffic A/B rollout) serves the article URL with NO
	 * `<meta name="generator">` while still carrying `.mw-editsection` chrome —
	 * Parsoid fingerprints reconstructed from the leaked prod parse:
	 * `rel="mw:WikiLink"` body links and nested bracket spans in the edit link. */
	function parsoidReadViewArticle(): string {
		const section = (n: number, title: string) =>
			`<div class="mw-heading mw-heading2"><h2>${title}</h2>` +
			`<span class="mw-editsection"><span class="mw-editsection-bracket">[</span>` +
			`<a href="/w/index.php?title=X&amp;action=edit&amp;section=${n}" title="Edit section: ${title}"><span>edit</span></a>` +
			`<span class="mw-editsection-bracket">]</span></span></div>` +
			`<p>${BODY_PARAGRAPH} <a rel="mw:WikiLink" href="/wiki/Brooks%27s_law">Brooks's law</a>.</p><p>${BODY_PARAGRAPH}</p>`;
		return (
			"<!DOCTYPE html><html>" +
			"<head><title>The Mythical Man-Month - Wikipedia</title></head>" +
			'<body><div id="content"><div class="mw-parser-output">' +
			`<p>${BODY_PARAGRAPH}</p>` +
			section(2, "Ideas presented") +
			section(3, "No silver bullet") +
			section(4, "Reception") +
			"</div></div></body></html>"
		);
	}

	it("keeps headings on a Parsoid read view, which has no generator meta", () => {
		const { parseHtml } = parser([mediaWikiSiteRules]);
		const result = parseHtml({
			url: "https://en.wikipedia.org/wiki/The_Mythical_Man-Month",
			html: parsoidReadViewArticle(),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const content = result.article.content;
		expect(content).toContain("Ideas presented");
		expect(content).toContain("Reception");
		expect(content).not.toContain(">edit<");
		expect(content).not.toContain("action=edit");
	});

	it("loses the same headings when the rule is not registered", () => {
		const { parseHtml } = parser([]);
		const result = parseHtml({
			url: "https://en.wikipedia.org/wiki/The_Mythical_Man-Month",
			html: mediaWikiArticle(),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.content).not.toContain("Ideas presented");
	});
});
