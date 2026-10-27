import { initGitHubPdfSiteRules } from "./github-pdf-site-rules";
import type { CrawlFetch } from "./crawl-fetch";

function viewerHtml(params: { rawBlobUrl: string; name?: string; path?: string; refType?: string }): string {
	return `<html><body><p>Loading document…</p><script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({
		payload: {
			codeViewBlobLayoutRoute: {
				path: params.path ?? "guides/paper.pdf",
				refInfo: { name: params.name ?? "main", currentOid: "a".repeat(40), refType: params.refType ?? "branch" },
				blob: { rawBlobUrl: params.rawBlobUrl },
			},
		},
	})}</script></body></html>`;
}

function siteFor(html: string) {
	const crawlFetch: CrawlFetch = async () => new Response(html);
	return initGitHubPdfSiteRules({ crawlFetch, logError: () => {} });
}

describe("GitHub PDF site rules", () => {
	it.each([
		["https://github.com/sample/docs/blob/main/guides/paper.pdf", true],
		["https://github.com/sample/docs/blob/release%2Fnext/guides/paper.pdf?plain=1#page=2", true],
		["https://github.com/sample/docs", false],
		["https://github.com/sample/docs/blob/main/paper.pdf?raw=1", false],
		["https://github.com/sample/docs/blob/main/paper.pdf?raw=true", false],
		["https://github.com/sample/docs/blob/main/index.ts", false],
		["https://github.com/sample/docs/tree/main/paper.pdf", false],
		["https://raw.githubusercontent.com/sample/docs/main/paper.pdf", false],
		["https://example.com/sample/docs/blob/main/paper.pdf", false],
		["https://github.com.evil.example/sample/docs/blob/main/paper.pdf", false],
		["https://user@github.com/sample/docs/blob/main/paper.pdf", false],
		["http://github.com/sample/docs/blob/main/paper.pdf", false],
		["https://github.com:444/sample/docs/blob/main/paper.pdf", false],
		["invalid", false],
	])("claims only supported PDF viewers: %s", (url, expected) => {
		expect(siteFor("").matches({ url, hostname: "github.com" })).toBe(expected);
	});

	it.each([
		{ name: "main", refType: "branch", rawRef: "refs/heads/main" },
		{ name: "release/next", refType: "branch", rawRef: "refs/heads/release/next" },
		{ name: "v2", refType: "tag", rawRef: "refs/tags/v2" },
		{ name: "main", refType: "branch", rawRef: "a".repeat(40) },
		{ name: "main", refType: "branch", rawRef: "main" },
	])("follows the declared raw file for $rawRef", async ({ name, refType, rawRef }) => {
		const rawBlobUrl = `https://github.com/sample/docs/raw/${rawRef}/guides/paper.pdf`;
		const site = siteFor(viewerHtml({ rawBlobUrl, name, refType }));
		const url = `https://github.com/sample/docs/blob/${encodeURIComponent(name)}/guides/paper.pdf?plain=1#page=2`;

		expect(await site.onCrawl({ url })).toEqual({ kind: "redirect", url: rawBlobUrl });
	});

	it("resolves a commit viewer using its source-declared branch and encoded file path", async () => {
		const rawBlobUrl = "https://github.com/sample/docs/raw/refs/heads/release/next/guides/a%20paper.pdf";
		const site = siteFor(viewerHtml({ rawBlobUrl, name: "release/next", path: "guides/a paper.pdf" }));

		expect(await site.onCrawl({ url: `https://github.com/sample/docs/blob/${"a".repeat(40)}/guides/a%20paper.pdf` })).toEqual({
			kind: "redirect", url: rawBlobUrl,
		});
	});

	it.each([
		"https://example.com/sample/docs/raw/main/guides/paper.pdf",
		"https://127.0.0.1/sample/docs/raw/main/guides/paper.pdf",
		"http://github.com/sample/docs/raw/main/guides/paper.pdf",
		"https://user:secret@github.com/sample/docs/raw/main/guides/paper.pdf",
		"https://:secret@github.com/sample/docs/raw/main/guides/paper.pdf",
		"https://github.com:444/sample/docs/raw/main/guides/paper.pdf",
		"https://github.com/other/docs/raw/main/guides/paper.pdf",
		"https://github.com/sample/other/raw/main/guides/paper.pdf",
		"https://github.com/sample/docs/raw/main/guides/other.pdf",
		"https://github.com/sample/docs/raw/other/guides/paper.pdf",
		"https://github.com/sample/docs/raw/main/guides/paper.pdf?url=http://localhost/",
		"https://github.com/sample/docs/raw/main/guides/paper.pdf#other",
		"https://github.com/sample/docs/blob/main/guides/paper.pdf",
		"invalid",
		"https://github.com/sample/docs/raw/main/guides/%FF.pdf",
	])("fails closed for an invalid raw target: %s", async (rawBlobUrl) => {
		expect(await siteFor(viewerHtml({ rawBlobUrl })).onCrawl({ url: "https://github.com/sample/docs/blob/main/guides/paper.pdf" })).toEqual({ kind: "failed" });
	});

	it.each([
		"<html><body>Loading document…</body></html>",
		'<script type="application/json" data-target="react-app.embeddedData">{</script>',
		'<script type="application/json" data-target="react-app.embeddedData">{ "payload": {} }</script>',
		viewerHtml({ rawBlobUrl: "https://github.com/sample/docs/raw/main/guides/paper.pdf", name: "other" }),
		viewerHtml({ rawBlobUrl: "https://github.com/sample/docs/raw/main/guides/paper.pdf", path: "other.pdf" }),
	])("fails closed instead of promoting missing, malformed or mismatched viewer metadata", async (html) => {
		expect(await siteFor(html).onCrawl({ url: "https://github.com/sample/docs/blob/main/guides/paper.pdf" })).toEqual({ kind: "failed" });
	});

	it("declines a non-PDF URL when called directly", async () => {
		expect(await siteFor("").onCrawl({ url: "https://github.com/sample/docs/blob/main/index.ts" })).toEqual({ kind: "skip" });
	});

	it("fails when GitHub refuses the viewer", async () => {
		const site = initGitHubPdfSiteRules({ crawlFetch: async () => new Response(null, { status: 404 }), logError: () => {} });
		expect(await site.onCrawl({ url: "https://github.com/sample/docs/blob/main/paper.pdf" })).toEqual({ kind: "failed" });
	});

	it.each([new Error("network failure"), "network failure"])("fails on a viewer fetch error", async (error) => {
		const logError = jest.fn();
		const site = initGitHubPdfSiteRules({ crawlFetch: async () => { throw error; }, logError });
		expect(await site.onCrawl({ url: "https://github.com/sample/docs/blob/main/paper.pdf" })).toEqual({ kind: "failed" });
		expect(logError).toHaveBeenCalledWith("[CrawlArticle] GitHub PDF viewer resolution failed", error instanceof Error ? error : undefined);
	});
});
