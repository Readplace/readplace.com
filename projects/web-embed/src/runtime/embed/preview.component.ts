import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";
import { PREVIEW_PAGE_STYLES } from "./preview.styles";

import { SNIPPET_VARIANTS, renderLiveSnippet } from "./snippet.component";

const PREVIEW_TEMPLATE = readFileSync(join(__dirname, "preview.template.html"), "utf-8");

const PREVIEW_STAGES = [
	{ key: "white", title: "White (#FFFFFF)", stageClass: "embed-preview__stage--white" },
	{ key: "surface", title: "Surface (#F7F8FA)", stageClass: "embed-preview__stage--surface" },
	{ key: "dark", title: "Dark (#1A202C)", stageClass: "embed-preview__stage--dark" },
] as const;

export interface PreviewPageInput {
	embedOrigin: string;
}

export function PreviewPage(input: PreviewPageInput): PageBody {
	const pageUrl = `${input.embedOrigin}/preview`;
	const stages = PREVIEW_STAGES.map((stage) => ({
		...stage,
		rows: SNIPPET_VARIANTS.map((variant) => ({
			label: `Variant ${variant.toUpperCase()}`,
			preview: renderLiveSnippet({
				variant,
				pageUrl,
				embedOrigin: input.embedOrigin,
				tracking: { source: `embed-preview-${stage.key}`, content: `save-variant-${variant}` },
			}),
		})),
	}));

	return {
		seo: {
			title: "Embed preview — Readplace embed kit",
			description: "Developer tool for previewing Readplace embed variants against multiple backgrounds.",
			canonicalUrl: pageUrl,
			robots: "noindex, nofollow",
		},
		styles: PREVIEW_PAGE_STYLES,
		bodyClass: "page-embed-preview",
		content: { html: render(PREVIEW_TEMPLATE, { stages }) },
	};
}
