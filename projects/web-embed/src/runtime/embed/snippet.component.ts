import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

const SNIPPETS_DIR = join(__dirname, "snippets");

const CANONICAL_APP_ORIGIN = "https://readplace.com";
const CANONICAL_EMBED_ORIGIN = "https://readplace.com/embed";

export const PAGE_URL_PLACEHOLDER = "PAGE_URL";
export const SNIPPET_MAX_BYTES = 1024;

export const SNIPPET_VARIANTS = ["a", "b", "c"] as const;
export type SnippetVariant = (typeof SNIPPET_VARIANTS)[number];

const SNIPPET_TEMPLATES: Record<SnippetVariant, string> = {
	a: readFileSync(join(SNIPPETS_DIR, "snippet-a.template.html"), "utf-8"),
	b: readFileSync(join(SNIPPETS_DIR, "snippet-b.template.html"), "utf-8"),
	c: readFileSync(join(SNIPPETS_DIR, "snippet-c.template.html"), "utf-8"),
};

export interface SnippetTracking {
	source: string;
	content: string;
}

function saveTarget(pageUrl: string): string {
	return `/save?url=${encodeURIComponent(pageUrl)}&save_surface=embed`;
}

function renderWithSaveHref(input: { variant: SnippetVariant; embedOrigin: string; saveHref: string }): string {
	return render(SNIPPET_TEMPLATES[input.variant], {
		embedOrigin: input.embedOrigin,
		saveHref: input.saveHref.replaceAll("&", "&amp;"),
	});
}

export function renderCanonicalSnippet(input: { variant: SnippetVariant; pageUrl: string }): string {
	return renderWithSaveHref({
		variant: input.variant,
		embedOrigin: CANONICAL_EMBED_ORIGIN,
		saveHref: `${CANONICAL_APP_ORIGIN}${saveTarget(input.pageUrl)}`,
	});
}

export function renderLiveSnippet(input: {
	variant: SnippetVariant;
	pageUrl: string;
	embedOrigin: string;
	tracking: SnippetTracking;
}): string {
	return renderWithSaveHref({
		variant: input.variant,
		embedOrigin: input.embedOrigin,
		saveHref: withInternalTracking(saveTarget(input.pageUrl), input.tracking),
	});
}

export function byteLength(snippet: string): number {
	return Buffer.byteLength(snippet, "utf-8");
}
