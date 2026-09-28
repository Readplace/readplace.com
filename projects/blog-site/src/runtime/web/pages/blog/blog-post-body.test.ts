import { drawFigure } from "./blog-figure";
import { initRenderPostBody, type RenderPostBodyDeps } from "./blog-post-body";
import { labelTableCells } from "./blog-table-labels";
import { withTldrCaret } from "./blog-tldr-caret";

function initRender(overrides: Partial<RenderPostBodyDeps>) {
	return initRenderPostBody({ drawFigure, labelTableCells, withTldrCaret, ...overrides });
}

describe("initRenderPostBody", () => {
	it("draws each rp-figure fence with the injected drawFigure, numbered from 1 in every post", () => {
		const renderPostBody = initRender({
			drawFigure: (body, index) => `<figure data-index="${index}">${body.trim()}</figure>`,
		});
		const post = "```rp-figure\nfirst\n```\n\n```js\nconst code = 1;\n```\n\n```rp-figure\nsecond\n```\n";
		const expected =
			'<figure data-index="1">first</figure>\n<pre><code class="language-js">const code = 1;\n</code></pre>\n<figure data-index="2">second</figure>\n';

		expect([renderPostBody(post), renderPostBody(post)]).toEqual([expected, expected]);
	});

	it("renders a fence that is not rp-figure as a code block with its content", () => {
		const renderPostBody = initRender({});

		expect(renderPostBody('```json\n{ "event": "pageview" }\n```\n\nAfter the block.\n')).toBe(
			'<pre><code class="language-json">{ &quot;event&quot;: &quot;pageview&quot; }\n</code></pre>\n<p>After the block.</p>\n',
		);
	});

	it("renders the token stream the injected labelTableCells leaves behind", () => {
		const renderPostBody = initRender({
			labelTableCells: (state) => {
				for (const token of state.tokens) if (token.type === "td_open") token.attrSet("data-label", "stubbed");
			},
		});

		expect(renderPostBody("| A | B |\n| --- | --- |\n| 1 | 2 |\n")).toBe(
			'<table>\n<thead>\n<tr>\n<th>A</th>\n<th>B</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td data-label="stubbed">1</td>\n<td data-label="stubbed">2</td>\n</tr>\n</tbody>\n</table>\n',
		);
	});

	it("returns what the injected withTldrCaret makes of the rendered HTML", () => {
		const renderPostBody = initRender({ withTldrCaret: (html) => `<div class="caret-stub">${html}</div>` });

		expect(renderPostBody("Hello")).toBe('<div class="caret-stub"><p>Hello</p>\n</div>');
	});
});
