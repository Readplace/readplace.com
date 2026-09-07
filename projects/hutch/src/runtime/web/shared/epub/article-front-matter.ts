import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import { pickExcerpt } from "../../../providers/article-summary/article-summary.helpers";
import { escapeXmlText } from "./epub-xhtml";

const SUMMARY_HEADING = "Summary (TL;DR)";
const PARAGRAPH_BREAK = "\n\n";

export interface ArticleFrontMatter {
	title: string;
	siteName: string;
	excerpt: string;
	summary: GeneratedSummary | undefined;
}

function paragraph(text: string): string {
	return `<p>${escapeXmlText(text)}</p>`;
}

export function articleFrontMatterXhtml(input: ArticleFrontMatter): string {
	const elements = [`<h1>${escapeXmlText(input.title)}</h1>`, paragraph(input.siteName)];
	const excerpt = pickExcerpt(input.summary, input.excerpt).text;
	if (excerpt) elements.push(paragraph(excerpt));
	if (input.summary !== undefined && input.summary.status === "ready") {
		elements.push(
			`<h2>${SUMMARY_HEADING}</h2>`,
			...input.summary.summary.split(PARAGRAPH_BREAK).map(paragraph),
		);
	}
	elements.push("<hr />");
	return elements.join("");
}
