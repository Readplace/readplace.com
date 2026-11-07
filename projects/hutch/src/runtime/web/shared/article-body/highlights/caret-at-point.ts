export interface CaretPoint {
	readonly node: Node;
	readonly offset: number;
}

export interface CaretDocument {
	caretPositionFromPoint?: (x: number, y: number) => { readonly offsetNode: Node; readonly offset: number } | null;
	caretRangeFromPoint(x: number, y: number): { readonly startContainer: Node; readonly startOffset: number } | null;
}

export function caretAtPoint(params: { document: CaretDocument; x: number; y: number }): CaretPoint | undefined {
	const { document, x, y } = params;
	if (document.caretPositionFromPoint) {
		const position = document.caretPositionFromPoint(x, y);
		return position === null ? undefined : { node: position.offsetNode, offset: position.offset };
	}
	const range = document.caretRangeFromPoint(x, y);
	return range === null ? undefined : { node: range.startContainer, offset: range.startOffset };
}
