import { initReadabilityParser } from "./readability-parser";
import { linkedinPreParser } from "./linkedin-pre-parser";

function postPage(
	bodyInner: string,
	opts: { title?: string | null; containerClass?: string } = {},
): string {
	const titleTag =
		opts.title === null ? "" : `<title>${opts.title ?? "Author on LinkedIn: Post | 2 comments"}</title>`;
	const containerClass = opts.containerClass ?? "feed-shared-update-v2__description";
	return `<!DOCTYPE html><html><head>${titleTag}</head><body>
		<nav>${'<a href="/x">nav</a>'.repeat(10)}</nav>
		<div class="feed-shared-update-v2">
			<div class="${containerClass}">
				<span class="update-components-text break-words">
					<span dir="ltr">${bodyInner}</span>
				</span>
			</div>
		</div>
	</body></html>`;
}

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
	"<br><br>",
	'<a href="/feed/hashtag/aisecurity">#aisecurity</a> <a href="/feed/hashtag/promptinjection">#promptinjection</a>',
].join("");

describe("linkedinPreParser.matches", () => {
	it("matches the apex hostname", () => {
		expect(linkedinPreParser.matches({ hostname: "linkedin.com" })).toBe(true);
	});

	it("matches the www subdomain", () => {
		expect(linkedinPreParser.matches({ hostname: "www.linkedin.com" })).toBe(true);
	});

	it("matches country subdomains", () => {
		expect(linkedinPreParser.matches({ hostname: "de.linkedin.com" })).toBe(true);
	});

	it("does not match other hostnames", () => {
		expect(linkedinPreParser.matches({ hostname: "example.com" })).toBe(false);
	});
});

describe("linkedinPreParser.extract", () => {
	it("wraps the leading sentence in its own paragraph (no orphan)", () => {
		const result = linkedinPreParser.extract({ html: postPage(POST_BODY) });

		expect(result?.bodyHtml).toContain("underestimated threat.</p>");
		expect(result?.bodyHtml).not.toMatch(/threat\.\s*<p[\s>]/);
	});

	it("converts paragraph breaks to multiple <p> and drops all <br><br>", () => {
		const result = linkedinPreParser.extract({ html: postPage(POST_BODY) });

		const paragraphCount = (result?.bodyHtml.match(/<p[\s>]/g) ?? []).length;
		expect(paragraphCount).toBeGreaterThanOrEqual(5);
		expect(result?.bodyHtml).not.toContain("<br><br>");
	});

	it("keeps a single <br> as a soft break and preserves inline formatting", () => {
		const result = linkedinPreParser.extract({ html: postPage(POST_BODY) });

		expect(result?.bodyHtml).toContain("class of attack.</strong><br>Treat untrusted text");
	});

	it("preserves links untouched (resolved later by the parser)", () => {
		const result = linkedinPreParser.extract({ html: postPage(POST_BODY) });

		expect(result?.bodyHtml).toContain('href="/feed/hashtag/aisecurity"');
	});

	it("collapses a run of 3+ <br> into a single paragraph break", () => {
		const result = linkedinPreParser.extract({
			html: postPage("First line.<br><br><br><br>Second line."),
		});

		expect(result?.bodyHtml).toBe("<p>First line.</p><p>Second line.</p>");
	});

	it("does not emit a leading empty paragraph for a leading single <br>", () => {
		const result = linkedinPreParser.extract({ html: postPage("<br>Only line.") });

		expect(result?.bodyHtml).toBe("<p>Only line.</p>");
	});

	it("does not emit a leading empty paragraph for a leading paragraph break", () => {
		const result = linkedinPreParser.extract({
			html: postPage("  <br><br>Body text here."),
		});

		expect(result?.bodyHtml).toBe("<p>Body text here.</p>");
	});

	it("preserves whitespace between inline elements within a paragraph", () => {
		const result = linkedinPreParser.extract({
			html: postPage("<strong>A</strong> <strong>B</strong><br><br>C"),
		});

		expect(result?.bodyHtml).toBe("<p><strong>A</strong> <strong>B</strong></p><p>C</p>");
	});

	it("treats whitespace between two <br> as a paragraph break", () => {
		const result = linkedinPreParser.extract({ html: postPage("A<br> <br>B") });

		expect(result?.bodyHtml).toBe("<p>A</p><p>B</p>");
	});

	it("falls back to the next container selector when the description wrapper is absent", () => {
		const html = `<!DOCTYPE html><html><head><title>t</title></head><body>
			<div class="update-components-text"><span dir="ltr">Line one.<br><br>Line two.</span></div>
		</body></html>`;

		const result = linkedinPreParser.extract({ html });

		expect(result?.bodyHtml).toBe("<p>Line one.</p><p>Line two.</p>");
	});

	it("returns undefined when no known post container is present", () => {
		const html =
			"<!DOCTYPE html><html><head><title>t</title></head><body><article><p>hi</p></article></body></html>";

		expect(linkedinPreParser.extract({ html })).toBeUndefined();
	});

	it("returns undefined when the post body has no <br> structure", () => {
		const result = linkedinPreParser.extract({
			html: postPage("Just one line with no breaks at all."),
		});

		expect(result).toBeUndefined();
	});

	it("returns undefined when the body is only breaks and whitespace", () => {
		expect(linkedinPreParser.extract({ html: postPage(" <br><br> ") })).toBeUndefined();
	});

	it("cleans a trailing comment count from the title", () => {
		const result = linkedinPreParser.extract({ html: postPage("A<br><br>B") });

		expect(result?.title).toBe("Author on LinkedIn: Post");
	});

	it("cleans a trailing | LinkedIn suffix from the title", () => {
		const result = linkedinPreParser.extract({
			html: postPage("A<br><br>B", { title: "My Post | LinkedIn" }),
		});

		expect(result?.title).toBe("My Post");
	});

	it("omits the title when the document has no <title>", () => {
		const result = linkedinPreParser.extract({
			html: postPage("A<br><br>B", { title: null }),
		});

		expect(result?.title).toBeUndefined();
		expect(result?.bodyHtml).toBe("<p>A</p><p>B</p>");
	});

	it("omits the title when it cleans to an empty string", () => {
		const result = linkedinPreParser.extract({
			html: postPage("A<br><br>B", { title: "| LinkedIn" }),
		});

		expect(result?.title).toBeUndefined();
	});
});

describe("linkedinPreParser end-to-end through parseHtml", () => {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => ({
			status: "fetched" as const,
			html: "",
			bodyHash: "a".repeat(64),
		}),
		sitePreParsers: [linkedinPreParser],
		logError: () => {},
	});

	it("produces paragraph structure with no orphan leading text", () => {
		const result = parseHtml({
			url: "https://www.linkedin.com/posts/ivan-vitiaev_activity-123-OoS_",
			html: postPage(POST_BODY),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const content = result.article.content;
		const paragraphCount = (content.match(/<p[\s>]/g) ?? []).length;
		expect(paragraphCount).toBeGreaterThanOrEqual(3);
		expect(content).not.toMatch(/threat\.\s*<p[\s>]/);
		expect(content).toContain("Over the last six months");
		expect(content).not.toContain("<br><br>");
	});
});
