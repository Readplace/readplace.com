import type { Component, ParsedComponent } from "./component.types";

const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

/** Heuristic: ~4 chars per token for English prose. Cloudflare's
 * x-markdown-tokens header is itself documented as an estimate; bundling a
 * real tokenizer (gpt-tokenizer ≈ 2 MB) would bloat the Lambda for marginal
 * accuracy. Swap behind this function if agents start treating the count
 * as authoritative. */
function estimateTokens(body: string): number {
	return Math.ceil(body.length / 4);
}

export function MarkdownPage(body: string, statusCode: number = 200): Component {
	return {
		to: (mediaType): ParsedComponent => {
			if (mediaType !== "text/markdown") {
				return { statusCode: 406, headers: {}, body: "" };
			}
			return {
				statusCode,
				headers: {
					"content-type": MARKDOWN_CONTENT_TYPE,
					"x-markdown-tokens": String(estimateTokens(body)),
				},
				body,
			};
		},
	};
}
