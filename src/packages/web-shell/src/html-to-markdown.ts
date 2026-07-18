import { NodeHtmlMarkdown } from "node-html-markdown";

const IGNORED_ELEMENTS = ["script", "style", "noscript", "template", "svg"];

const converter = new NodeHtmlMarkdown({
	ignore: IGNORED_ELEMENTS,
	useInlineLinks: false,
	useLinkReferenceDefinitions: false,
	keepDataImages: false,
});

for (const translators of [
	converter.aTagTranslators,
	converter.tableTranslators,
	converter.tableRowTranslators,
	converter.tableCellTranslators,
]) {
	translators.set(IGNORED_ELEMENTS.join(","), { ignore: true, recurse: false });
}

export function htmlToMarkdown(html: string): string {
	return converter.translate(html);
}
