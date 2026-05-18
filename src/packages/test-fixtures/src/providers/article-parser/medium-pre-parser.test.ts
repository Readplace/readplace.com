import { mediumPreParser } from "./medium-pre-parser";

/** Filler body that survives MIN_BODY_CHARS so individual rule tests can
 * still assert on whatever the rule under test left behind. */
const FILLER_PARAGRAPH =
	"<p>This is filler body content that exceeds the minimum body character threshold so the pre-parser does not bail out and return undefined. The body must be long enough to land above the threshold after the rule under test has finished stripping the chrome elements being verified by the surrounding test case.</p>";

function buildHtml(params: {
	ogSiteName?: string;
	appName?: string;
	articleInner?: string;
	titleTag?: string;
	containerTag?: string;
	includeContainer?: boolean;
	includeFiller?: boolean;
} = {}) {
	const ogMeta = params.ogSiteName
		? `<meta property="og:site_name" content="${params.ogSiteName}">`
		: "";
	const appMeta = params.appName
		? `<meta name="application-name" content="${params.appName}">`
		: "";
	const titleTag = params.titleTag ?? "<title>Page</title>";
	const tag = params.containerTag ?? "article";
	const filler = params.includeFiller === false ? "" : FILLER_PARAGRAPH;
	const inner = (params.articleInner ?? "") + filler;
	const body = params.includeContainer === false ? inner : `<${tag}>${inner}</${tag}>`;
	return `<html><head>${titleTag}${ogMeta}${appMeta}</head><body>${body}</body></html>`;
}

describe("mediumPreParser.matches", () => {
	it.each([
		["medium.com"],
		["fagnerbrack.com"],
		["levelup.gitconnected.com"],
		["random.example"],
	])("returns true for %s (fingerprint check lives in extract)", (hostname) => {
		expect(mediumPreParser.matches({ hostname })).toBe(true);
	});
});

describe("mediumPreParser.extract — fingerprint gate", () => {
	it("returns undefined when og:site_name is missing", () => {
		const html = buildHtml({ articleInner: "<p>Body.</p>" });

		expect(mediumPreParser.extract({ html })).toBeUndefined();
	});

	it("returns undefined when og:site_name is not 'Medium'", () => {
		const html = buildHtml({ ogSiteName: "Substack", articleInner: "<p>Body.</p>" });

		expect(mediumPreParser.extract({ html })).toBeUndefined();
	});

	it("accepts application-name=Medium as a fallback fingerprint", () => {
		const html = buildHtml({
			appName: "Medium",
			articleInner: "<h1>Headline</h1>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("This is filler body content");
	});

	it("activates when og:site_name is missing but data-testid='authorPhoto' is present", () => {
		const html = buildHtml({
			articleInner:
				'<h1>Headline</h1><div><img data-testid="authorPhoto" alt="Author"></div>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("authorPhoto");
		expect(result?.bodyHtml).toContain("This is filler body content");
	});

	it("activates and strips authorPhoto when data-testid is on a wrapper div (friends-link variant)", () => {
		const html = buildHtml({
			articleInner:
				'<h1>Headline</h1><div data-testid="authorPhoto"><a href="/author"><img src="avatar.jpg"></a></div>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("authorPhoto");
		expect(result?.bodyHtml).not.toContain("avatar.jpg");
		expect(result?.bodyHtml).toContain("This is filler body content");
	});

	it("activates when og:site_name is not 'Medium' but data-testid='storyReadTime' is present", () => {
		const html = buildHtml({
			ogSiteName: "Fagner Brack",
			articleInner:
				'<h1>Headline</h1><span data-testid="storyReadTime">5 min read</span>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("5 min read");
		expect(result?.bodyHtml).toContain("This is filler body content");
	});

	it("returns undefined when fingerprint present but no article container", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: "<p>Loose body</p>",
			includeContainer: false,
		});

		expect(mediumPreParser.extract({ html })).toBeUndefined();
	});

	it("returns undefined when stripping reduces the body below MIN_BODY_CHARS so default Readability handles it", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			includeFiller: false,
			articleInner:
				'<a href="/byline"><img data-testid="authorPhoto"></a><span data-testid="storyReadTime">5 min read</span>',
		});

		expect(mediumPreParser.extract({ html })).toBeUndefined();
	});
});

describe("mediumPreParser.extract — author photo / read time / publish date", () => {
	it("strips the author <a> link that wraps the authorPhoto img and removes the read-time + publish-date spans", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<div><a href="/author"><img data-testid="authorPhoto" alt="Author"></a><span data-testid="storyReadTime">5 min read</span><span data-testid="storyPublishDate">Jun 21, 2018</span></div>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("authorPhoto");
		expect(result?.bodyHtml).not.toContain("5 min read");
		expect(result?.bodyHtml).not.toContain("Jun 21, 2018");
		expect(result?.bodyHtml).not.toContain('href="/author"');
	});

	it("preserves the filler body content alongside the chrome stripping", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<div><a href="/author"><img data-testid="authorPhoto" alt="Author"></a></div>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("This is filler body content");
	});

	it("preserves a storyReadTime-attributed span when its text is not 'N min read'", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<p><span data-testid="storyReadTime">Not a duration phrase</span></p>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("Not a duration phrase");
	});

	it("preserves body text that reads '5 min read' but has no data-testid", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: "<p>The presentation will be 5 min read on the agenda.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("The presentation will be 5 min read on the agenda.");
	});

	it("strips 'Jun 21, 2018' formatted storyPublishDate inside its enclosing <p>", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<p><span data-testid="storyPublishDate">Jun 21, 2018</span></p>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("Jun 21, 2018");
	});

	it("strips 'Jun 21' (no year) formatted storyPublishDate inside its enclosing <p>", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: '<p><span data-testid="storyPublishDate">Jun 21</span></p>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("Jun 21");
	});

	it("preserves body text that reads 'Jun 21, 2018' but has no data-testid", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: "<p>I visited Jun 21, 2018 to remember the date.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("I visited Jun 21, 2018 to remember the date.");
	});

	it("removes just the authorPhoto img when it has no enclosing <a> link", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: '<img data-testid="authorPhoto" alt="Author">',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("authorPhoto");
	});

	it("strips authorPhoto when data-testid is on a wrapper div instead of the img", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<div data-testid="authorPhoto"><a href="/author"><img src="avatar.jpg" alt="Author"></a></div>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("authorPhoto");
		expect(result?.bodyHtml).not.toContain("avatar.jpg");
	});

	it("strips ALL authorPhoto elements when multiple exist (friends-link duplicate)", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<div><a href="/author"><img data-testid="authorPhoto" alt="Author"></a></div><p>Body.</p><div data-testid="authorPhoto"><a href="/follow"><img src="avatar2.jpg"></a></div>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("authorPhoto");
		expect(result?.bodyHtml).not.toContain("avatar2.jpg");
		expect(result?.bodyHtml).toContain("Body.");
	});
});

describe("mediumPreParser.extract — picture tooltip", () => {
	it("strips the 'Press enter…' span inside figure > [role=button] and preserves the sibling picture", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<figure><div role="button"><span>Press enter or click to view image in full size</span><div><picture><img src="x.jpg"></picture></div></div></figure>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("Press enter or click to view image in full size");
		expect(result?.bodyHtml).toContain("<picture>");
	});

	it("preserves the picture tooltip text when it appears in body prose (no figure[role=button] ancestor)", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				"<p>Press enter or click to view image in full size — this article is about accessibility.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("this article is about accessibility");
		expect(result?.bodyHtml).toContain("Press enter or click to view image in full size");
	});
});

describe("mediumPreParser.extract — claps separator '--'", () => {
	it("strips a <p><span>--</span></p> that follows the authorPhoto in document order", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<div><img data-testid="authorPhoto" alt="A"></div><p><span>--</span></p>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toMatch(/<p[^>]*><span[^>]*>\s*--\s*<\/span><\/p>/);
	});

	it("preserves a <p><span>--</span></p> when no authorPhoto anchor is present", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: "<p><span>--</span></p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("<span>--</span>");
	});

	it("preserves em-dashes inside body prose", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<div><img data-testid="authorPhoto" alt="A"></div><p>The point — really — is preserved.</p>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("The point — really — is preserved.");
	});
});

describe("mediumPreParser.extract — footer subscribe CTA", () => {
	it("strips the 'Get X's stories in your inbox' section including following CTA paragraphs", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				"<p>Body paragraph.</p><section><h2>Get Mary's stories in your inbox</h2><p>Join Medium for free to get updates from this writer.</p><p>Remember me for faster sign in</p></section>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("Body paragraph.");
		expect(result?.bodyHtml).not.toContain("stories in your inbox");
		expect(result?.bodyHtml).not.toContain("Join Medium for free");
		expect(result?.bodyHtml).not.toContain("Remember me for faster sign in");
	});

	it("preserves a <p> that reads 'Get Mary's stories in your inbox' (CTA fingerprint requires an h2)", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: "<p>Get Mary's stories in your inbox if you want them in your email.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("Get Mary's stories in your inbox");
	});

	it("preserves body paragraphs that coincidentally mention 'join Medium for free' outside the footer CTA", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				"<p>You should join Medium for free to get updates if you can — it's worth trying.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("You should join Medium for free");
	});

	it("handles curly apostrophes in the footer h2", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				"<section><h2>Get Fayner Brack’s stories in your inbox</h2></section><p>Body.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("stories in your inbox");
		expect(result?.bodyHtml).toContain("Body.");
	});

	it("removes only the h2 when no wrapping section/div container exists", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: "<p>Body.</p><h2>Get Mary's stories in your inbox</h2>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("stories in your inbox");
		expect(result?.bodyHtml).toContain("Body.");
	});

	it("falls back to defensive sweep for 'Join Medium for free' / 'Remember me' outside the footer cluster", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				"<section><h2>Get Mary's stories in your inbox</h2></section><p>Join Medium for free to get updates from this writer.</p><p>Remember me for faster sign in</p><p>Body.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).not.toContain("Join Medium for free");
		expect(result?.bodyHtml).not.toContain("Remember me for faster sign in");
		expect(result?.bodyHtml).toContain("Body.");
	});
});

describe("mediumPreParser.extract — title and body preservation", () => {
	it("extracts the title from the first <h1> inside the container", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner: "<h1>Article Headline</h1><p>Body.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.title).toBe("Article Headline");
	});

	it("falls back to <title> when no <h1> exists inside the container", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			titleTag: "<title>Title From Tag | Medium</title>",
			articleInner: "<p>Body.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.title).toBe("Title From Tag");
	});

	it("returns undefined title when neither an <h1> nor a <title> tag is present", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			titleTag: "",
			articleInner: "<p>Body.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.title).toBeUndefined();
	});

	it("preserves a subtitle <h2> immediately after the byline cluster (the dek scenario)", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				'<h1>Headline</h1><h2>The subtitle dek that triggered the chrome leak.</h2><div><img data-testid="authorPhoto"><span data-testid="storyReadTime">5 min read</span></div><p>Body.</p>',
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("The subtitle dek that triggered the chrome leak.");
		expect(result?.bodyHtml).not.toContain("5 min read");
	});

	it("preserves multiple body paragraphs and non-footer h2 sub-headings verbatim", () => {
		const html = buildHtml({
			ogSiteName: "Medium",
			articleInner:
				"<p>First paragraph.</p><h2>A non-footer subheading</h2><p>Second paragraph.</p><p>Third paragraph.</p>",
		});

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("First paragraph.");
		expect(result?.bodyHtml).toContain("A non-footer subheading");
		expect(result?.bodyHtml).toContain("Second paragraph.");
		expect(result?.bodyHtml).toContain("Third paragraph.");
	});

	it("is a no-op on a pair-programming-style article with no byline / read-time / footer h2 inside the container", () => {
		const inner =
			"<h1>Headline</h1><p>First paragraph straight after the title.</p><p>Second paragraph.</p>";
		const html = buildHtml({ ogSiteName: "Medium", articleInner: inner });

		const result = mediumPreParser.extract({ html });

		expect(result?.bodyHtml).toContain("First paragraph straight after the title.");
		expect(result?.bodyHtml).toContain("Second paragraph.");
	});
});
