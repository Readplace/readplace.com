import { NodeHtmlMarkdown } from "node-html-markdown";

const converter = new NodeHtmlMarkdown({
	ignore: ["script", "style", "noscript", "template", "svg"],
	useInlineLinks: false,
	useLinkReferenceDefinitions: false,
	keepDataImages: false,
});

export function htmlToMarkdown(html: string): string {
	return converter.translate(html);
}
