import type { SeoMetadata } from "./page-body.types";

export interface MarkdownFrontmatterOpts {
	formattedDate?: string;
}

export function buildMarkdownFrontmatter(
	seo: SeoMetadata,
	opts: MarkdownFrontmatterOpts = {},
): string {
	const lines: string[] = [`# ${seo.title}`, "", seo.description];
	const meta: string[] = [];
	if (seo.author) meta.push(`Author: ${seo.author}`);
	if (opts.formattedDate) meta.push(`Date: ${opts.formattedDate}`);
	if (seo.canonicalUrl) meta.push(`Canonical: ${seo.canonicalUrl}`);
	if (meta.length > 0) {
		lines.push("", meta.join("  \n"));
	}
	return lines.join("\n");
}
