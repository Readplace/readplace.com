import { parseHTML } from "linkedom";
import { linkedinSiteRules } from "./linkedin-pre-parser";
import { initReadabilityParser } from "./readability-parser";

/* Parse a body fragment, run the in-place transform, and return the body HTML
 * before and after. Decline cases assert `after === before`; transform cases
 * assert the exact rebuilt markup. */
function runTransform(bodyHtml: string): { before: string; after: string } {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`,
	);
	const before = document.body.innerHTML;
	linkedinSiteRules.transform({ document });
	return { before, after: document.body.innerHTML };
}

describe("linkedinSiteRules.matches", () => {
	it("matches www.linkedin.com", () => {
		expect(linkedinSiteRules.matches({ url: "https://www.linkedin.com/posts/x", hostname: "www.linkedin.com" })).toBe(true);
	});

	it("matches the bare linkedin.com apex", () => {
		expect(linkedinSiteRules.matches({ url: "https://linkedin.com/posts/x", hostname: "linkedin.com" })).toBe(true);
	});

	it("declines a non-LinkedIn host", () => {
		expect(linkedinSiteRules.matches({ url: "https://example.com/x", hostname: "example.com" })).toBe(false);
	});
});

describe("linkedinSiteRules.transform", () => {
	it("splits a `\\n\\n` run in a pre-wrap host into separate <p> blocks", () => {
		const { after } = runTransform(
			'<p class="whitespace-pre-wrap" dir="ltr">Lead.\n\nSecond.</p>',
		);
		expect(after).toBe('<p dir="ltr">Lead.</p><p dir="ltr">Second.</p>');
	});

	it("turns a single `\\n` into a <br> soft break within one paragraph", () => {
		const { after } = runTransform('<p class="whitespace-pre-wrap">1. First\n2. Second</p>');
		expect(after).toBe("<p>1. First<br>2. Second</p>");
	});

	it("preserves inline hashtag <a> children, moving them into a paragraph", () => {
		const { after } = runTransform(
			'<p class="whitespace-pre-wrap">Body.\n\n<a href="/h">#tag</a></p>',
		);
		expect(after).toBe('<p>Body.</p><p><a href="/h">#tag</a></p>');
	});

	it("keeps the host `dir` on every rebuilt paragraph", () => {
		const { after } = runTransform(
			'<p class="whitespace-pre-wrap" dir="rtl">شیء.\n\nآخر.</p>',
		);
		expect(after).toBe('<p dir="rtl">شیء.</p><p dir="rtl">آخر.</p>');
	});

	it("omits `dir` when the host has none", () => {
		const { after } = runTransform('<p class="whitespace-pre-wrap">A\n\nB</p>');
		expect(after).toBe("<p>A</p><p>B</p>");
	});

	it("collapses a run of 3+ newlines into a single paragraph break", () => {
		const { after } = runTransform('<p class="whitespace-pre-wrap">A\n\n\n\nB</p>');
		expect(after).toBe("<p>A</p><p>B</p>");
	});

	it("starts cleanly when the host text leads with a paragraph break", () => {
		const { after } = runTransform('<p class="whitespace-pre-wrap">\n\nA</p>');
		expect(after).toBe("<p>A</p>");
	});

	it("matches an inline `white-space: pre-wrap` style, not just the class", () => {
		const { after } = runTransform('<div style="white-space: pre-wrap">A\n\nB</div>');
		expect(after).toBe("<p>A</p><p>B</p>");
	});

	it("matches via style when the class is present but not pre-wrap", () => {
		const { after } = runTransform(
			'<div class="foo" style="white-space:pre-wrap">A\n\nB</div>',
		);
		expect(after).toBe("<p>A</p><p>B</p>");
	});

	it("rebuilds every pre-wrap host, leaving the choice of body to Readability", () => {
		const { after } = runTransform(
			'<p class="whitespace-pre-wrap">A\n\nB</p>' +
				'<p class="whitespace-pre-wrap">C\n\nD</p>',
		);
		expect(after).toBe("<p>A</p><p>B</p><p>C</p><p>D</p>");
	});

	it("leaves a host with no newline untouched", () => {
		const { before, after } = runTransform('<p class="whitespace-pre-wrap">single line</p>');
		expect(after).toBe(before);
	});

	it("leaves a whitespace-only pre-wrap host untouched (yields no paragraphs)", () => {
		const { before, after } = runTransform('<p class="whitespace-pre-wrap">\n\n</p>');
		expect(after).toBe(before);
	});

	it("leaves elements that do not preserve whitespace untouched", () => {
		const { before, after } = runTransform(
			"<p>A\n\nB</p>" +
				'<p class="foo">C\n\nD</p>' +
				'<p class="bar" style="color:red">E\n\nF</p>',
		);
		expect(after).toBe(before);
	});
});

const LINKEDIN_POST = [
	"Anthropic has claude writing 100% of the code and 100+ available dev positions:",
	"\n\n",
	"1. The cycle of punched cards (70s)\n2. The cycle of the web (2000s)\n3. The cycle of AI agents (2026+)",
	"\n\n",
	"In every cycle the tech changed and got faster, but software engineering fundamentals stayed the same and architecture still matters.",
	"\n\n",
	"The issue now is that people realised coding was never the bottleneck.",
].join("");

function linkedinPostPage(commentary: string): string {
	return `<!DOCTYPE html><html><head><title>Author on LinkedIn</title></head><body>
		<nav>${'<a href="/x">nav link</a>'.repeat(10)}</nav>
		<div class="post">
			<p class="attributed-text-segment-list__content whitespace-pre-wrap break-words" dir="ltr">${commentary}</p>
		</div>
	</body></html>`;
}

describe("linkedinSiteRules end-to-end through parseHtml", () => {
	const parser = (preParsers: Parameters<typeof initReadabilityParser>[0]["sitePreParsers"]) =>
		initReadabilityParser({
			crawlArticle: async () => ({
				status: "fetched" as const,
				html: "",
				bodyHash: "a".repeat(64),
			}),
			sitePreParsers: preParsers,
			logError: () => {},
		});

	it("rebuilds the LinkedIn pre-wrap post into multiple paragraphs", () => {
		const { parseHtml } = parser([linkedinSiteRules]);
		const result = parseHtml({
			url: "https://www.linkedin.com/posts/author_activity-123-AbC",
			html: linkedinPostPage(LINKEDIN_POST),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const content = result.article.content;
		expect((content.match(/<p[\s>]/g) ?? []).length).toBeGreaterThanOrEqual(3);
		expect(content).toContain("available dev positions");
		expect(content).toContain("never the bottleneck");
		expect(content).toContain(
			'available dev positions:</p><p dir="ltr">1. The cycle of punched cards (70s)<br>',
		);
	});

	it("leaves the same page mushed when the pre-parser is not registered", () => {
		const { parseHtml } = parser([]);
		const result = parseHtml({
			url: "https://www.linkedin.com/posts/author_activity-123-AbC",
			html: linkedinPostPage(LINKEDIN_POST),
			thumbnailUrl: null,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.article.content).toContain("dev positions:\n\n1.");
	});
});
