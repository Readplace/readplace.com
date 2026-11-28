import type { ArticleFrontMatter } from "../../../domain/readlist/book-chapter.types";
import { pickExcerpt } from "../../../providers/article-summary/article-summary.helpers";
import { escapeXmlText, paragraphXhtml } from "./epub-xhtml";

const SUMMARY_HEADING = "Summary (TL;DR)";
const PARAGRAPH_BREAK = "\n\n";

export const COLOPHON_XHTML = "<hr /><p>Read the Web, not the Slop.</p>";

export type { ArticleFrontMatter } from "../../../domain/readlist/book-chapter.types";

export function articleFrontMatterXhtml(input: ArticleFrontMatter): string {
	const elements = [`<h1>${escapeXmlText(input.title)}</h1>`, paragraphXhtml(input.siteName)];
	const excerpt = pickExcerpt(input.summary, input.excerpt).text;
	if (excerpt) elements.push(paragraphXhtml(excerpt));
	if (input.summary !== undefined && input.summary.status === "ready") {
		elements.push(
			`<h2>${SUMMARY_HEADING}</h2>`,
			...input.summary.summary.split(PARAGRAPH_BREAK).map(paragraphXhtml),
		);
	}
	elements.push("<hr />");
	return elements.join("");
}
