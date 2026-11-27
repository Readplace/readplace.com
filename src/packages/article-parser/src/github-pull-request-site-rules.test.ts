import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const PR_PATH = "/example-org/woodshop/pull/42";
const PR_URL = `https://github.com${PR_PATH}`;
const noNetwork = () => {
	throw new Error("PR extraction uses the fetched page");
};

const siteRules = initArticleSiteRules({ crawlFetch: noNetwork, logError: noNetwork }).siteRules;

function parsePage(params: { html: string; url: string; useSiteRules?: boolean }) {
	const { parseHtml } = initReadabilityParser({
		coverageRules: { inspect: () => [] },
		logError: noNetwork,
		siteRules: params.useSiteRules === false ? [] : siteRules,
		readabilityAdditions,
	});
	const result = parseHtml({ url: params.url, documentUrl: params.url, html: params.html, thumbnailUrl: null });
	assert(result.ok);
	return result.article;
}

function publicConversation(conversation: string): string {
	return `<!DOCTYPE html><html><head>
		<title>Refine the clamp - Handle &amp; jaws by maker · Pull Request #42 · example-org/woodshop · GitHub</title>
		<meta property="og:title" content="Refine the clamp - Handle &amp; jaws by maker · Pull Request #42">
		<meta property="og:url" content="${PR_URL}">
		<meta name="octolytics-dimension-repository_public" content="true">
		<meta name="user-login" content="">
	</head><body>
		<div id="diff-comparison-viewer-container">
			<header data-component="SplitPageLayout.Header">
				<div data-component="TitleArea"><h1><span>Refine the clamp - Handle &amp; jaws</span><span class="sr-only"> - #42</span></h1></div>
				<span data-component="StateLabel">Merged</span>
				<a href="${PR_PATH}/commits">Commits</a><a href="${PR_PATH}/files">Files changed</a>
			</header>
			<div class="js-discussion">${conversation}</div>
		</div>
		<aside><p>${"Popular repositories and site navigation. ".repeat(25)}</p></aside>
	</body></html>`;
}

const openingComment = `
	<div class="js-command-palette-pull-body"><div class="js-comment" id="pullrequest-987">
		<a class="author" href="/maker">maker</a>
		<a href="#issue-987"><relative-time datetime="2026-02-01T00:00:00Z">February 1</relative-time></a>
		<div class="js-comment-body"><p>We increased the length of the handle from ten to twelve centimeters.</p></div>
	</div></div>`;

describe("GitHub pull request conversation", () => {
	it("reads the opening, authors, discussion and a shared inline review context in source order", () => {
		const html = publicConversation(`
			<div class="js-command-palette-pull-body">
				<div class="js-comment" id="pullrequest-987">
					<a class="author" href="/maker">maker</a>
					<a href="#issue-987"><relative-time datetime="2026-02-01T00:00:00Z">February 1</relative-time></a>
					<div class="js-comment-body">
						<h2>Bench notes</h2>
						<p>The new oak handle is longer than the original handle. This keeps fingers away from the jaws under load.
							See the <a href="/example-org/woodshop/issues/9">measurements</a> and the <a href="#issuecomment-17">reply below</a>.</p>
						<button>Copy Markdown</button>
						<ul><li><input type="checkbox" checked>Cut the handle</li><li><input type="checkbox">Sand the jaws</li></ul>
						<details><summary>Load <em>samples</em></summary>
							<table><thead><tr><th>Trial</th><th>Load</th></tr></thead><tbody><tr><td>Oak</td><td>35 N</td></tr></tbody></table>
							<pre><code>measure(35);\n  release();</code></pre>
						</details>
					</div>
				</div>
			</div>
			<div class="TimelineItem">
				<div class="TimelineItem-badge"><svg class="octicon-eye"></svg></div>
				<div class="TimelineItem-body"><div><a class="author" href="/reviewer">reviewer</a> requested changes.
					<a href="#pullrequestreview-9"><relative-time datetime="2026-02-02T00:00:00Z">February 2</relative-time></a></div>
					<div><a href="${PR_PATH}/files/abc">View reviewed changes</a></div></div>
			</div>
			<review-thread-collapsible class="review-thread-component">
				<a class="text-mono" href="${PR_PATH}/files#diff-abc">src/clamp.ts</a>
				<span class="Label Label--warning">Outdated</span>
				<table class="diff-table"><tbody>
					<tr><td class="blob-num" data-line-number="8"></td><td class="blob-num" data-line-number="9"></td><td class="blob-code"><span class="blob-code-inner">  open();</span></td></tr>
					<tr><td class="blob-num" data-line-number="9"></td><td class="blob-num"></td><td class="blob-code blob-code-deletion"><span class="blob-code-inner">  hold(35);</span></td></tr>
					<tr><td class="blob-num"></td><td class="blob-num" data-line-number="10"></td><td class="blob-code blob-code-addition"><span class="blob-code-inner">  hold(25);</span></td></tr>
				</tbody></table>
				<div class="js-comment">
					<a class="author" href="/reviewer">reviewer</a><span class="Label">Contributor</span>
					<a href="#discussion_r123"><relative-time datetime="2026-02-02T00:00:00Z">February 2</relative-time></a>
					<div class="js-comment-body"><p>Keep the lower <code>hold</code> load for oak.</p></div>
				</div>
				<div class="js-comment">
					<a class="author" href="/maker">maker</a>
					<a href="#discussion_r124"><relative-time datetime="2026-02-03T00:00:00Z">February 3</relative-time></a>
					<div class="js-comment-body"><p>I measured the lower load on the same bench.</p></div>
				</div>
			</review-thread-collapsible>
			<div class="TimelineItem">
				<div class="TimelineItem-badge"><svg class="octicon-git-merge"></svg></div>
				<div class="TimelineItem-body">The maintainer merged <a href="/example-org/woodshop/commit/abc">abc</a>.
					<div class="Details-content--hidden">An internal merge log.</div></div>
			</div>
			<div class="js-comment">
				<a class="author" href="/apps/sample-bench">sample-bench</a><span class="Label">Bot</span>
				<a href="#issuecomment-17"><relative-time datetime="2026-02-04T00:00:00Z">February 4</relative-time></a>
				<div class="js-comment-body"><blockquote>All measurements passed.</blockquote>
					<p><a href="/proof.png"><img src="/proof.png" alt="Clamp under test"></a></p></div>
			</div>
			<template><div class="js-comment-body"><p>A hidden draft.</p></div></template>
			<div class="js-comment" hidden><div class="js-comment-body"><p>A hidden moderation notice.</p></div></div>
		`);

		const article = parsePage({ html, url: `${PR_URL}?utm_source=sample#issuecomment-17` });
		expect(article.title).toBe("Refine the clamp - Handle & jaws");
		const served = sanitizeArticleHtml(article.content);
		const { document } = parseHTML(`<html><body>${served}</body></html>`);
		const text = document.body.textContent?.replace(/\s+/g, " ");
		expect(text).toMatch(/Merged.*Commits.*Files changed.*maker.*2026-02-01.*Bench notes.*The new oak handle.*Cut the handle.*Sand the jaws.*Load samples.*Trial.*35 N.*reviewer requested changes.*src\/clamp\.ts · Outdated.*reviewer.*Keep the lower hold load for oak.*maker.*I measured the lower load.*The maintainer merged abc.*sample-bench.*Bot.*All measurements passed/);
		expect([...document.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["[x] Cut the handle", "[ ] Sand the jaws"]);
		expect([...document.querySelectorAll("pre > code")].map((code) => code.textContent)).toEqual([
			"measure(35);\n  release();",
			"8/9    open();\n9/ -  hold(35);\n/10 +  hold(25);",
		]);
		expect([...document.querySelectorAll("table td")].map((cell) => cell.textContent)).toEqual(["Oak", "35 N"]);
		expect(document.querySelector("p > em")?.textContent).toBe("samples");
		expect(document.querySelector("img")?.outerHTML).toMatch(/src="https:\/\/github\.com\/proof\.png"/);
		expect(document.querySelector("img")?.getAttribute("alt")).toBe("Clamp under test");
		expect([...document.querySelectorAll("a[href]")].map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
			["Commits", `${PR_URL}/commits`],
			["Files changed", `${PR_URL}/files`],
			["maker", "https://github.com/maker"],
			["2026-02-01T00:00:00Z", `${PR_URL}#issue-987`],
			["measurements", "https://github.com/example-org/woodshop/issues/9"],
			["reply below", `${PR_URL}#issuecomment-17`],
			["reviewer", "https://github.com/reviewer"],
			["2026-02-02T00:00:00Z", `${PR_URL}#pullrequestreview-9`],
			["View reviewed changes", `${PR_URL}/files/abc`],
			["src/clamp.ts", `${PR_URL}/files#diff-abc`],
			["reviewer", "https://github.com/reviewer"],
			["2026-02-02T00:00:00Z", `${PR_URL}#discussion_r123`],
			["maker", "https://github.com/maker"],
			["2026-02-03T00:00:00Z", `${PR_URL}#discussion_r124`],
			["abc", "https://github.com/example-org/woodshop/commit/abc"],
			["sample-bench", "https://github.com/apps/sample-bench"],
			["2026-02-04T00:00:00Z", `${PR_URL}#issuecomment-17`],
			["", "https://github.com/proof.png"],
		]);
		expect(article.content).not.toMatch(/Copy Markdown|internal merge log|hidden draft|hidden moderation notice|Popular repositories|<input\b/);
	});

	it.each([
		[PR_URL, 'repository_public" content="true"', 'repository_public" content="false"'],
		[PR_URL, 'user-login" content=""', 'user-login" content="signed-in-user"'],
		[PR_URL, 'property="og:url"', 'property="source:url"'],
		[PR_URL, `"og:url" content="${PR_URL}"`, '"og:url" content="junk://source"'],
		[PR_URL, `"og:url" content="${PR_URL}"`, `"og:url" content="${PR_URL}/files"`],
		[PR_URL, 'property="og:title"', 'property="source:title"'],
		[PR_URL, 'data-component="SplitPageLayout.Header"', 'data-component="Main"'],
		[PR_URL, 'data-component="TitleArea"', 'data-component="Description"'],
		[PR_URL, 'data-component="StateLabel"', 'data-component="Unknown"'],
		[PR_URL, 'class="js-discussion"', 'class="new-discussion-view"'],
		[PR_URL, 'class="js-command-palette-pull-body"', 'class="page-section"'],
		[PR_URL, 'class="js-command-palette-pull-body"', 'class="js-command-palette-pull-body" hidden'],
		[PR_URL, 'class="author"', 'class="account"'],
		[PR_URL, 'datetime="2026-02-01T00:00:00Z"', 'aria-label="February 1"'],
		[PR_URL, 'href="#issue-987"', 'aria-label="Opening permalink"'],
		[`${PR_URL}/files`, "", ""],
		[`${PR_URL}/commits`, "", ""],
		["https://github.com/example-org/woodshop/issues/42", "", ""],
		["https://github.example.com/example-org/woodshop/pull/42", "", ""],
	])("uses default parsing for %s with source marker %s replaced", (url, marker, replacement) => {
		const html = publicConversation(openingComment).replace(marker, replacement);
		expect(parsePage({ html, url })).toEqual(parsePage({ html, url, useSiteRules: false }));
	});

	it("keeps default parsing when a visible body has no comment container", () => {
		const html = publicConversation(`${openingComment}<div class="js-comment-body"><p>Another body with an unknown author.</p></div>`);
		expect(parsePage({ html, url: PR_URL })).toEqual(parsePage({ html, url: PR_URL, useSiteRules: false }));
	});

	it.each(["text-mono", "diff-table", "blob-num", "blob-code", "blob-code-inner"])("keeps default parsing when a review has no %s markup", (marker) => {
		const html = publicConversation(`${openingComment}
			<review-thread-collapsible class="review-thread-component">
				<a class="text-mono" href="${PR_PATH}/files#diff-abc">src/clamp.ts</a>
				<table class="diff-table"><tbody><tr>
					<td class="blob-num"></td><td class="blob-num" data-line-number="10"></td>
					<td class="blob-code"><span class="blob-code-inner">  hold(25);</span></td>
				</tr></tbody></table>
				<div class="js-comment">
					<a class="author" href="/reviewer">reviewer</a>
					<a href="#discussion_r123"><relative-time datetime="2026-02-02T00:00:00Z">February 2</relative-time></a>
					<div class="js-comment-body"><p>Keep the lower hold load for oak.</p></div>
				</div>
			</review-thread-collapsible>`).replace(`class="${marker}"`, 'class="unrecognized"');
		expect(parsePage({ html, url: PR_URL })).toEqual(parsePage({ html, url: PR_URL, useSiteRules: false }));
	});
});
