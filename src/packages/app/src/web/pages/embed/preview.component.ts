import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EmbedBase } from "./embed-base.component";
import type { Component } from "../../component.types";
import { PREVIEW_PAGE_STYLES } from "./preview.styles";
import { render } from "../../render";
import { renderSnippet } from "./snippet.component";

const PREVIEW_TEMPLATE = readFileSync(join(__dirname, "preview.template.html"), "utf-8");

export interface PreviewPageInput {
	appOrigin: string;
	embedOrigin: string;
}

export function PreviewPage(input: PreviewPageInput): Component {
	const origins = { appOrigin: input.appOrigin, embedOrigin: input.embedOrigin, pageUrl: `${input.embedOrigin}/preview` };
	const content = render(PREVIEW_TEMPLATE, {
		previewA: renderSnippet("a", origins),
		previewB: renderSnippet("b", origins),
		previewC: renderSnippet("c", origins),
	});

	return EmbedBase({
		seo: {
			title: "Embed preview — Readplace embed kit",
			description: "Developer tool for previewing Readplace embed variants against multiple backgrounds.",
			canonicalUrl: `${input.embedOrigin}/preview`,
			robots: "noindex, nofollow",
		},
		pageStyles: PREVIEW_PAGE_STYLES,
		bodyClass: "page-embed-preview",
		content,
		appOrigin: input.appOrigin,
	});
}
