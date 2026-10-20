import { codeSpanOnOneLine } from "./code-span-on-one-line";
import { initHtmlToMarkdown } from "./markdown-conversion";
import { tableToMarkdown } from "./table-to-markdown";

export const htmlToMarkdown = initHtmlToMarkdown({
	tableToMarkdown,
	codeSpanOnOneLine,
});
