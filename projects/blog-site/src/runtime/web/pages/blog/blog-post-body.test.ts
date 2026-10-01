import { drawFigure } from "./blog-figure";
import { initRenderPostBody, type RenderPostBodyDeps } from "./blog-post-body";
import { labelTableCells } from "./blog-table-labels";
import { withTldrCaret } from "./blog-tldr-caret";

function initRender(overrides: Partial<RenderPostBodyDeps>) {
	return initRenderPostBody({ drawFigure, labelTableCells, withTldrCaret, ownHost: "readplace.com", ...overrides });
}

describe("initRenderPostBody", () => {
	it("draws each rp-figure fence with the injected drawFigure, numbered from 1 in every post", () => {
		const renderPostBody = initRender({
			drawFigure: (body, index) => `<figure data-index="${index}">${body.trim()}</figure>`,
		});
		const post = "```rp-figure\nfirst\n```\n\n```js\nconst code = 1;\n```\n\n```rp-figure\nsecond\n```\n";
		const expected =
			'<figure data-index="1">first</figure>\n<pre><code class="language-js">const code = 1;\n</code></pre>\n<figure data-index="2">second</figure>\n';

		expect([renderPostBody({ slug: "a-post", content: post }), renderPostBody({ slug: "a-post", content: post })]).toEqual([expected, expected]);
	});

	it("renders a fence that is not rp-figure as a code block with its content", () => {
		const renderPostBody = initRender({});

		expect(renderPostBody({ slug: "a-post", content: '```json\n{ "event": "pageview" }\n```\n\nAfter the block.\n' })).toBe(
			'<pre><code class="language-json">{ &quot;event&quot;: &quot;pageview&quot; }\n</code></pre>\n<p>After the block.</p>\n',
		);
	});

	it("renders the token stream the injected labelTableCells leaves behind", () => {
		const renderPostBody = initRender({
			labelTableCells: (state) => {
				for (const token of state.tokens) if (token.type === "td_open") token.attrSet("data-label", "stubbed");
			},
		});

		expect(renderPostBody({ slug: "a-post", content: "| A | B |\n| --- | --- |\n| 1 | 2 |\n" })).toBe(
			'<table>\n<thead>\n<tr>\n<th>A</th>\n<th>B</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td data-label="stubbed">1</td>\n<td data-label="stubbed">2</td>\n</tr>\n</tbody>\n</table>\n',
		);
	});

	it("returns what the injected withTldrCaret makes of the rendered HTML", () => {
		const renderPostBody = initRender({ withTldrCaret: (html) => `<div class="caret-stub">${html}</div>` });

		expect(renderPostBody({ slug: "a-post", content: "Hello" })).toBe('<div class="caret-stub"><p>Hello</p>\n</div>');
	});

	describe("links to the site's own pages", () => {
		const renderPostBody = initRender({ withTldrCaret: (html) => html });
		const hrefOf = (markdown: string) => {
			const match = renderPostBody({ slug: "a-post", content: markdown }).match(/href="([^"]*)"/);
			expect(match).not.toBeNull();
			return match?.[1];
		};

		it.each([
			["https://readplace.com/install", "/install?utm_source=blog-a-post&utm_medium=internal&utm_content=install"],
			["https://readplace.com/signup", "/signup?utm_source=blog-a-post&utm_medium=internal&utm_content=signup"],
			["http://readplace.com/mcp", "/mcp?utm_source=blog-a-post&utm_medium=internal&utm_content=mcp"],
			["https://readplace.com", "/?utm_source=blog-a-post&utm_medium=internal&utm_content=home"],
			[
				"https://readplace.com/view/github.com/some/repo",
				"/view/github.com/some/repo?utm_source=blog-a-post&utm_medium=internal&utm_content=view-github-com-some-repo",
			],
			["/import", "/import?utm_source=blog-a-post&utm_medium=internal&utm_content=import"],
		])("tags %s with the post as source and its destination as content", (href, expected) => {
			expect(hrefOf(`[link](${href})`)).toBe(expected.replaceAll("&", "&amp;"));
		});

		it("keeps an own link's query and fragment, and names the query in the content so two destinations never share one", () => {
			expect(hrefOf("[iPhone](https://readplace.com/install?client=iphone#steps)")).toBe(
				"/install?client=iphone&amp;utm_source=blog-a-post&amp;utm_medium=internal&amp;utm_content=install-client-iphone#steps",
			);
		});

		it.each([
			["an already tagged root-relative link", "/blog/x?utm_source=blog-other&utm_medium=internal&utm_content=post-x"],
			["an already tagged absolute own link", "https://readplace.com/login?utm_source=hand&utm_medium=internal&utm_content=login"],
			["another site", "https://example.com/install"],
			["a protocol-relative link", "//readplace.com/install"],
			["a same-page anchor", "#section"],
			["a mail link", "mailto:hello@readplace.com"],
		])("leaves %s untouched", (_label, href) => {
			expect(hrefOf(`[link](${href})`)).toBe(href.replaceAll("&", "&amp;"));
		});
	});
});
