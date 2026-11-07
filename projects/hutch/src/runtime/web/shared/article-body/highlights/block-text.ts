import { collectTextChunks } from "@packages/domain/article/highlight";

export interface BlockPoint {
	readonly node: Node;
	readonly offset: number;
}

export interface BlockText {
	readonly text: string;
	pointAt(offset: number): BlockPoint;
	offsetOf(point: BlockPoint): number | undefined;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface PlacedChunk {
	readonly node: Node;
	readonly start: number;
	readonly end: number;
}

export function blockTextOf(block: Node): BlockText {
	const placed: PlacedChunk[] = [];
	let text = "";
	for (const chunk of collectTextChunks<Node>(block)) {
		if (chunk.blockBoundaryBefore && text.length > 0) text += "\n";
		placed.push({
			node: chunk.node,
			start: text.length,
			end: text.length + chunk.text.length,
		});
		text += chunk.text;
	}

	const pointAt = (offset: number): BlockPoint => {
		const chunk = placed.find((candidate) => candidate.end >= offset);
		assert(chunk, "a text offset inside the block falls in one of its text nodes");
		return { node: chunk.node, offset: offset - chunk.start };
	};

	const offsetOf = (point: BlockPoint): number | undefined => {
		if (!block.contains(point.node)) return undefined;
		const document = block.ownerDocument;
		assert(document, "a block in the reader belongs to a document");
		const caret = document.createRange();
		caret.setStart(point.node, point.offset);
		for (const chunk of placed) {
			if (chunk.node === point.node) return chunk.start + point.offset;
			if (caret.comparePoint(chunk.node, 0) >= 0) return chunk.start;
		}
		return text.length;
	};

	return { text, pointAt, offsetOf };
}
