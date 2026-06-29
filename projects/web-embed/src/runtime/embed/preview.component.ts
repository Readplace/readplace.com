import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { PREVIEW_PAGE_STYLES } from "./preview.styles";

import { renderSnippet } from "./snippet.component";

const PREVIEW_TEMPLATE = readFileSync(join(__dirname, "preview.template.html"), "utf-8");

export interface PreviewPageInput {
	appOrigin: string;
	embedOrigin: string;
}

export function PreviewPage(input: PreviewPageInput): PageBody {
	const origins = { appOrigin: input.appOrigin, embedOrigin: input.embedOrigin, pageUrl: `${input.embedOrigin}/preview` };
	const content = render(PREVIEW_TEMPLATE, {
		previewA: renderSnippet("a", origins),
		previewB: renderSnippet("b", origins),
		previewC: renderSnippet("c", origins),
	});

	return {
		seo: {
			title: "Embed preview — Readplace embed kit",
			description: "Developer tool for previewing Readplace embed variants against multiple backgrounds.",
			canonicalUrl: `${input.embedOrigin}/preview`,
			robots: "noindex, nofollow",
		},
		styles: PREVIEW_PAGE_STYLES,
		bodyClass: "page-embed-preview",
		content: { html: content },
	};
}
