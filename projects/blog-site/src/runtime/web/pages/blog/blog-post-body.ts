import assert from "node:assert";
import MarkdownIt from "markdown-it";
import { withInternalTracking } from "@packages/web-shell";
import { FIGURE_FENCE } from "./blog-figure.parse";

/** Expands an ```rp-figure fence into a drawn figure, leaving every other fence
 * as ordinary code. The data stays in the post as a dozen lines of `key: value`,
 * for the same reason `withTldrCaret` keeps the caret out of the content files:
 * a drawing does not belong in 67 markdown files. It also decides what the
 * `text/markdown` representation carries, since that is built from the raw
 * source — a fence reaches an AI client as labelled numbers, where the expanded
 * HTML would reach it as markup. */
interface PostEnv {
	figureCount: number;
	slug: string;
}

export interface RenderPostBodyDeps {
	drawFigure: (body: string, index: number) => string;
	labelTableCells: (state: MarkdownIt.StateCore) => void;
	withTldrCaret: (html: string) => string;
	ownHost: string;
}

function isOwnLink(link: { href: string; ownHost: string }): boolean {
	if (link.href.startsWith("/")) return !link.href.startsWith("//");
	if (!URL.canParse(link.href)) return false;
	const url = new URL(link.href);
	return /^https?:$/.test(url.protocol) && url.hostname === link.ownHost;
}

function tagOwnLink(link: { href: string; ownHost: string; slug: string }): string {
	if (!isOwnLink(link)) return link.href;
	const url = new URL(link.href, `https://${link.ownHost}`);
	if (url.searchParams.has("utm_source")) return link.href;
	const destination = `${url.pathname}${url.search}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return withInternalTracking(`${url.pathname}${url.search}${url.hash}`, {
		source: `blog-${link.slug}`,
		content: destination === "" ? "home" : destination,
	});
}

export function initRenderPostBody(
	deps: RenderPostBodyDeps,
): (post: { slug: string; content: string }) => string {
	const renderer = new MarkdownIt({ html: true });
	const renderCodeFence = renderer.renderer.rules.fence;
	assert(renderCodeFence, "markdown-it ships a default fence rule");
	renderer.renderer.rules.fence = (tokens, index, options, env: PostEnv, self) => {
		const token = tokens[index];
		if (token.info.trim() !== FIGURE_FENCE) return renderCodeFence(tokens, index, options, env, self);
		env.figureCount += 1;
		return `${deps.drawFigure(token.content, env.figureCount)}\n`;
	};
	renderer.renderer.rules.link_open = (tokens, index, options, env: PostEnv, self) => {
		const token = tokens[index];
		const href = token.attrGet("href");
		assert(href !== null, "markdown-it gives every link_open an href");
		token.attrSet("href", tagOwnLink({ href, ownHost: deps.ownHost, slug: env.slug }));
		return self.renderToken(tokens, index, options);
	};
	renderer.core.ruler.push("table_cell_labels", deps.labelTableCells);

	/** Renders one post's body. The figure counter lives in markdown-it's per-render
	 * `env` so a figure's input ids depend only on its position within its own post
	 * — a counter shared across the directory would renumber every later post's
	 * inputs whenever an earlier one gained a figure. */
	return function renderPostBody(post: { slug: string; content: string }): string {
		const env: PostEnv = { figureCount: 0, slug: post.slug };
		return deps.withTldrCaret(renderer.render(post.content, env));
	};
}
