import { parseHTML } from "linkedom";
import { initReadabilityParser } from "./readability-parser";
import { promoteBrParagraphHosts } from "./promote-br-paragraph-hosts";

/* Parse a body fragment, run the transform, and return the body HTML before
 * and after. Comparing the two is robust to linkedom's serialization quirks:
 * decline cases assert `after === before`, transform cases assert the exact
 * promoted markup. */
function runTransform(bodyHtml: string): { before: string; after: string } {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`,
	);
	const before = document.body.innerHTML;
	promoteBrParagraphHosts(document);
	return { before, after: document.body.innerHTML };
}

describe("promoteBrParagraphHosts", () => {
	it("promotes an inline span host and its inline wrapper to <div> (LinkedIn shape)", () => {
		const { after } = runTransform(
			'<div class="feed-shared-update-v2__description">' +
				'<span class="update-components-text break-words">' +
				'<span dir="ltr">Lead line.<br><br>Second paragraph.</span>' +
				"</span></div>",
		);

		expect(after).toBe(
			'<div class="feed-shared-update-v2__description">' +
				'<div class="update-components-text break-words">' +
				'<div dir="ltr">Lead line.<br><br>Second paragraph.</div>' +
				"</div></div>",
		);
	});

	it("promotes only the host when its parent is already a block", () => {
		const { after } = runTransform(
			'<div class="post"><span dir="ltr">First.<br><br>Second.</span></div>',
		);

		expect(after).toBe(
			'<div class="post"><div dir="ltr">First.<br><br>Second.</div></div>',
		);
	});

	it("preserves dir and class attributes so RTL posts keep their direction", () => {
		const { after } = runTransform(
			'<span dir="rtl" class="x">شیء.<br><br>آخر.</span>',
		);

		expect(after).toBe('<div class="x" dir="rtl">شیء.<br><br>آخر.</div>');
	});

	it("keeps single <br> as soft breaks and inline formatting when promoting", () => {
		const { after } = runTransform(
			"<span>Intro.<br><br><strong>Bold.</strong><br>soft break<br><br>End.</span>",
		);

		expect(after).toBe(
			"<div>Intro.<br><br><strong>Bold.</strong><br>soft break<br><br>End.</div>",
		);
	});

	it("treats whitespace between two <br> as a paragraph break", () => {
		const { after } = runTransform('<span dir="ltr">A<br> <br>B</span>');

		expect(after).toBe('<div dir="ltr">A<br> <br>B</div>');
	});

	it("collapses a run of 3+ <br> into one promotion (single host)", () => {
		const { after } = runTransform("<span>First.<br><br><br><br>Second.</span>");

		expect(after).toBe("<div>First.<br><br><br><br>Second.</div>");
	});

	it("promotes multiple independent hosts on the same page", () => {
		const { after } = runTransform(
			'<section><span dir="ltr">Post one a.<br><br>Post one b.</span></section>' +
				'<section><span dir="ltr">Post two a.<br><br>Post two b.</span></section>',
		);

		expect(after).toBe(
			'<section><div dir="ltr">Post one a.<br><br>Post one b.</div></section>' +
				'<section><div dir="ltr">Post two a.<br><br>Post two b.</div></section>',
		);
	});

	it("declines a single <br> soft break with no paragraph run", () => {
		const { before, after } = runTransform("<span>One line<br>next line</span>");

		expect(after).toBe(before);
	});

	it("declines when the <br><br> host is already a block element", () => {
		const { before, after } = runTransform("<div>Already.<br><br>Block.</div>");

		expect(after).toBe(before);
	});

	it("declines an inline host whose subtree contains a block element", () => {
		const { before, after } = runTransform(
			"<span>Lead.<br><br>Body.<blockquote>quote</blockquote></span>",
		);

		expect(after).toBe(before);
	});

	it("declines a block-structured page with no <br> at all", () => {
		const { before, after } = runTransform(
			"<article><p>One paragraph.</p><p>Another paragraph.</p></article>",
		);

		expect(after).toBe(before);
	});
});

const POST_BODY = [
	"AI security is the new frontier and prompt injection is its most underestimated threat.",
	"<br><br>",
	"Over the last six months I have been auditing LLM-powered products and the same failure modes keep coming up.",
	"<br><br>",
	"<strong>1. Prompt injection is not a bug, it is a class of attack.</strong><br>Treat untrusted text the same way you treat untrusted SQL.",
	"<br><br>",
	"<strong>2. Defence in depth still applies.</strong><br>Input validation and human-in-the-loop approvals each catch a different slice.",
	"<br><br>",
	"If you are building agents this year, threat-model the tool layer first.",
].join("");

function linkedinPostPage(bodyInner: string): string {
	return `<!DOCTYPE html><html><head><title>Author on LinkedIn</title></head><body>
		<nav>${'<a href="/x">nav link</a>'.repeat(10)}</nav>
		<div class="feed-shared-update-v2">
			<div class="feed-shared-update-v2__description">
				<span class="update-components-text break-words">
					<span dir="ltr">${bodyInner}</span>
				</span>
			</div>
		</div>
	</body></html>`;
}

describe("promoteBrParagraphHosts end-to-end through parseHtml", () => {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => ({
			status: "fetched" as const,
			html: "",
			bodyHash: "a".repeat(64),
		}),
		siteRules: [],
		logError: () => {},
	});

	it("rebuilds an inline LinkedIn post into paragraphs with no orphan leading line", () => {
		const result = parseHtml({
			url: "https://www.linkedin.com/posts/ivan-vitiaev_activity-123-OoS_",
			html: linkedinPostPage(POST_BODY),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.content).toBe(
			'<div class="page" id="readability-page-1"><div dir="ltr">' +
				"<p>AI security is the new frontier and prompt injection is its most underestimated threat.</p>" +
				"<p>Over the last six months I have been auditing LLM-powered products and the same failure modes keep coming up.</p>" +
				"<p><strong>1. Prompt injection is not a bug, it is a class of attack.</strong><br>Treat untrusted text the same way you treat untrusted SQL.</p>" +
				"<p><strong>2. Defence in depth still applies.</strong><br>Input validation and human-in-the-loop approvals each catch a different slice.</p>" +
				"<p>If you are building agents this year, threat-model the tool layer first.</p>" +
				"</div></div>",
		);
	});

	it("extracts the real article, not a <br><br> footer address (in-place never discards the page)", () => {
		const html = `<!DOCTYPE html><html><head><title>Real Article</title></head><body>
			<article>
				<h1>Real Article</h1>
				<p>The first substantial paragraph carries enough genuine prose for Readability to score this as the article body.</p>
				<p>The second substantial paragraph continues that prose so the scorer is confident the article is the dominant block.</p>
				<p>The third substantial paragraph adds yet more real content to outweigh anything in the page chrome and footer.</p>
			</article>
			<footer><address><span>Readplace Inc.<br><br>123 Example Street<br><br>Springfield, USA</span></address></footer>
		</body></html>`;

		const result = parseHtml({ url: "https://example.com/article", html, thumbnailUrl: null });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.content).toBe(
			'<div class="page" id="readability-page-1"><article>\n\t\t\t\t\n\t\t\t\t' +
				"<p>The first substantial paragraph carries enough genuine prose for Readability to score this as the article body.</p>\n\t\t\t\t" +
				"<p>The second substantial paragraph continues that prose so the scorer is confident the article is the dominant block.</p>\n\t\t\t\t" +
				"<p>The third substantial paragraph adds yet more real content to outweigh anything in the page chrome and footer.</p>\n\t\t\t" +
				"</article></div>",
		);
	});

	it("still extracts the article when a <br><br> email signature is present (does no harm)", () => {
		const html = `<!DOCTYPE html><html><head><title>Newsletter</title></head><body>
			<article>
				<h1>Newsletter</h1>
				<p>This is the genuine newsletter body with enough words to be the dominant, highest-scoring content block on the page.</p>
				<p>A second real paragraph keeps the article comfortably ahead of the short signature block that follows it below.</p>
				<p>A third real paragraph ensures the scorer never mistakes the signature for the article content itself here.</p>
			</article>
			<div class="signature"><span>Best regards,<br><br>Jane Doe<br>Principal Engineer</span></div>
		</body></html>`;

		const result = parseHtml({ url: "https://example.com/newsletter", html, thumbnailUrl: null });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.content).toContain("genuine newsletter body");
	});
});
