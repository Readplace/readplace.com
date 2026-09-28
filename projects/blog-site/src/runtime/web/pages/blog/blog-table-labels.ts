import assert from "node:assert";
import type MarkdownIt from "markdown-it";

function headingText(state: MarkdownIt.StateCore, inlineIndex: number): string {
	const { children } = state.tokens[inlineIndex];
	assert(children, "markdown-it pushes an inline token with children after every th_open");
	return state.md.renderer.renderInlineAsText(children, state.md.options, state.env).trim();
}

export function labelTableCells(state: MarkdownIt.StateCore): void {
	let headings: string[] = [];
	let column = 0;
	state.tokens.forEach((token, index) => {
		if (token.type === "thead_open") headings = [];
		if (token.type === "tr_open") column = 0;
		if (token.type === "th_open") headings.push(headingText(state, index + 1));
		if (token.type !== "td_open") return;
		const label = headings[column];
		column += 1;
		if (label !== "") token.attrSet("data-label", label);
	});
}
