export interface TextChunkNode<N> {
	readonly nodeType: number;
	readonly nodeName: string;
	readonly nodeValue: string | null;
	readonly childNodes: ArrayLike<N>;
}

export interface TextChunk<N> {
	node: N;
	text: string;
	blockBoundaryBefore: boolean;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
	"ADDRESS",
	"ARTICLE",
	"ASIDE",
	"BLOCKQUOTE",
	"BR",
	"CAPTION",
	"DD",
	"DETAILS",
	"DIV",
	"DL",
	"DT",
	"FIGCAPTION",
	"FIGURE",
	"FOOTER",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HEADER",
	"HR",
	"LI",
	"MAIN",
	"NAV",
	"OL",
	"P",
	"PRE",
	"SECTION",
	"SUMMARY",
	"TABLE",
	"TBODY",
	"TD",
	"TFOOT",
	"TH",
	"THEAD",
	"TR",
	"UL",
]);

const SKIPPED_ELEMENTS: ReadonlySet<string> = new Set([
	"SCRIPT",
	"STYLE",
	"TEMPLATE",
	"NOSCRIPT",
]);

export function collectTextChunks<N extends TextChunkNode<N>>(
	root: N,
): TextChunk<N>[] {
	const chunks: TextChunk<N>[] = [];
	let boundaryPending = false;

	const visit = (node: N): void => {
		if (node.nodeType === TEXT_NODE) {
			chunks.push({
				node,
				text: node.nodeValue ?? "",
				blockBoundaryBefore: boundaryPending,
			});
			boundaryPending = false;
			return;
		}
		if (node.nodeType !== ELEMENT_NODE) return;
		const name = node.nodeName.toUpperCase();
		if (SKIPPED_ELEMENTS.has(name)) return;
		const isBlock = BLOCK_ELEMENTS.has(name);
		if (isBlock) boundaryPending = true;
		for (let i = 0; i < node.childNodes.length; i++) visit(node.childNodes[i]);
		if (isBlock) boundaryPending = true;
	};

	for (let i = 0; i < root.childNodes.length; i++) visit(root.childNodes[i]);
	return chunks;
}
