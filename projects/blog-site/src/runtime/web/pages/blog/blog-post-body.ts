import assert from "node:assert";
import MarkdownIt from "markdown-it";
import { FIGURE_FENCE } from "./blog-figure.parse";

/** Expands an ```rp-figure fence into a drawn figure, leaving every other fence
 * as ordinary code. The data stays in the post as a dozen lines of `key: value`,
 * for the same reason `withTldrCaret` keeps the caret out of the content files:
 * a drawing does not belong in 67 markdown files. It also decides what the
 * `text/markdown` representation carries, since that is built from the raw
 * source — a fence reaches an AI client as labelled numbers, where the expanded
 * HTML would reach it as markup. */
interface FigureEnv {
	figureCount: number;
}

export interface RenderPostBodyDeps {
	drawFigure: (body: string, index: number) => string;
	labelTableCells: (state: MarkdownIt.StateCore) => void;
	withTldrCaret: (html: string) => string;
}

export function initRenderPostBody(deps: RenderPostBodyDeps): (content: string) => string {
	const renderer = new MarkdownIt({ html: true });
	const renderCodeFence = renderer.renderer.rules.fence;
	assert(renderCodeFence, "markdown-it ships a default fence rule");
	renderer.renderer.rules.fence = (tokens, index, options, env: FigureEnv, self) => {
		const token = tokens[index];
		if (token.info.trim() !== FIGURE_FENCE) return renderCodeFence(tokens, index, options, env, self);
		env.figureCount += 1;
		return `${deps.drawFigure(token.content, env.figureCount)}\n`;
	};
	renderer.core.ruler.push("table_cell_labels", deps.labelTableCells);

	/** Renders one post's body. The figure counter lives in markdown-it's per-render
	 * `env` so a figure's input ids depend only on its position within its own post
	 * — a counter shared across the directory would renumber every later post's
	 * inputs whenever an earlier one gained a figure. */
	return function renderPostBody(content: string): string {
		const env: FigureEnv = { figureCount: 0 };
		return deps.withTldrCaret(renderer.render(content, env));
	};
}
