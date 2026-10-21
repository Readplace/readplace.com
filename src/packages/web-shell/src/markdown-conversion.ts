import assert from "node:assert";
import {
	NodeHtmlMarkdown,
	PostProcessResult,
	TranslatorCollection,
	type TranslatorConfig,
} from "node-html-markdown";

interface TableContent {
	outsideCells: string;
	caption: string;
	rows: readonly (readonly string[])[];
}

export type TableToMarkdown = (table: TableContent) => string;

export type CodeSpanOnOneLine = (content: string) => string;

const IGNORED_ELEMENTS = ["script", "style", "noscript", "template", "svg"];

export function initHtmlToMarkdown(deps: {
	tableToMarkdown: TableToMarkdown;
	codeSpanOnOneLine: CodeSpanOnOneLine;
}): (html: string) => string {
	const converter = new NodeHtmlMarkdown(
		{
			ignore: IGNORED_ELEMENTS,
			useInlineLinks: false,
			useLinkReferenceDefinitions: false,
			keepDataImages: false,
		},
		{
			table: ({ visitor }) =>
				tableTranslator({
					documentTranslators: visitor.instance.translators,
					tableToMarkdown: deps.tableToMarkdown,
				}),
		},
	);
	converter.aTagTranslators.set(IGNORED_ELEMENTS.join(","), {
		ignore: true,
		recurse: false,
	});
	const libraryCode = converter.translators.get("code");
	assert(
		typeof libraryCode === "function",
		"node-html-markdown translates <code> with a factory",
	);
	converter.translators.set("code", (context) => {
		const config = libraryCode(context);
		const { postprocess } = config;
		return postprocess === undefined || context.preserveWhitespace
			? config
			: {
					...config,
					postprocess: (rendered) => {
						const content = deps.codeSpanOnOneLine(rendered.content);
						return content === ""
							? PostProcessResult.RemoveNode
							: postprocess({ ...rendered, content });
					},
				};
	});
	return (html) => converter.translate(html);
}

function tableTranslator(params: {
	documentTranslators: TranslatorCollection;
	tableToMarkdown: TableToMarkdown;
}): TranslatorConfig {
	const rows: string[][] = [[]];
	let caption = "";
	const structure = new TranslatorCollection();
	for (const [tags, config] of params.documentTranslators.entries())
		structure.set(tags, config);
	structure.set("tr", () => {
		rows.push([]);
		return {};
	});
	structure.set("td,th", () => {
		const row = rows[rows.length - 1];
		const slot = row.push("") - 1;
		return {
			postprocess: ({ content }) => {
				row[slot] = content.trim();
				return PostProcessResult.RemoveNode;
			},
		};
	});
	structure.set("caption", {
		postprocess: ({ content }) => {
			caption = content.trim();
			return PostProcessResult.RemoveNode;
		},
	});
	return {
		surroundingNewlines: 2,
		childTranslators: structure,
		postprocess: ({ content }) =>
			params.tableToMarkdown({
				outsideCells: content.trim(),
				caption,
				rows: rows.filter((row) => row.length > 0),
			}),
	};
}
