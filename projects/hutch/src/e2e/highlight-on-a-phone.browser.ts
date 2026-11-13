export function pointInsideText(input: { root: string; exact: string }): {
	x: number;
	y: number;
} {
	const root = document.querySelector(input.root);
	if (!root) throw new Error(`pointInsideText needs ${input.root}`);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const at = (node.textContent ?? "").indexOf(input.exact);
		if (at < 0) continue;
		const range = document.createRange();
		range.setStart(node, at);
		range.setEnd(node, at + input.exact.length);
		const first = range.getClientRects()[0];
		if (!first) break;
		return { x: first.left + first.width / 2, y: first.top + first.height / 2 };
	}
	throw new Error(`pointInsideText found no rendered text "${input.exact}"`);
}

export function selectedText(): string {
	return window.getSelection()?.toString() ?? "";
}

export function selectionIsCollapsed(): boolean {
	const selection = window.getSelection();
	return selection === null || selection.isCollapsed;
}

export function toolbarBelowSelection(input: { toolbar: string }): {
	toolbarTop: number;
	selectionBottom: number;
} {
	const toolbar = document.querySelector(input.toolbar);
	if (!toolbar) throw new Error(`toolbarBelowSelection needs ${input.toolbar}`);
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) throw new Error("toolbarBelowSelection needs a selection");
	const rects = selection.getRangeAt(0).getClientRects();
	const last = rects[rects.length - 1];
	if (!last) throw new Error("toolbarBelowSelection needs a selection holding text");
	return {
		toolbarTop: toolbar.getBoundingClientRect().top,
		selectionBottom: last.bottom,
	};
}

export function selectAcrossParagraphs(input: { root: string; first: string; second: string }): void {
	const root = document.querySelector(input.root);
	if (!root) throw new Error(`selectAcrossParagraphs needs ${input.root}`);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let start: { node: Node; at: number } | undefined;
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const text = node.textContent ?? "";
		if (!start && text.includes(input.first)) start = { node, at: text.indexOf(input.first) };
		const at = text.indexOf(input.second);
		if (start && at >= 0) {
			const selection = window.getSelection();
			if (!selection) throw new Error("selectAcrossParagraphs needs a document selection");
			selection.setBaseAndExtent(start.node, start.at, node, at + input.second.length);
			return;
		}
	}
	throw new Error(`selectAcrossParagraphs found no "${input.first}" followed by "${input.second}"`);
}

export function scrollWindowBy(input: { y: number }): void {
	window.scrollBy({ top: input.y, behavior: "instant" });
}

export function scrollWindowToTop(): void {
	window.scrollTo({ top: 0, behavior: "instant" });
}

export function windowScrollY(): number {
	return window.scrollY;
}

export function previewClearOfMarks(input: { preview: string; marks: string }): boolean {
	const preview = document.querySelector(input.preview);
	if (!preview) throw new Error(`previewClearOfMarks needs ${input.preview}`);
	const rects = Array.from(document.querySelectorAll(input.marks)).flatMap((mark) => Array.from(mark.getClientRects()));
	if (rects.length === 0) throw new Error(`previewClearOfMarks needs ${input.marks}`);
	const box = {
		top: Math.min(...rects.map((rect) => rect.top)),
		bottom: Math.max(...rects.map((rect) => rect.bottom)),
		left: Math.min(...rects.map((rect) => rect.left)),
		right: Math.max(...rects.map((rect) => rect.right)),
	};
	const panel = preview.getBoundingClientRect();
	return panel.bottom <= box.top || panel.top >= box.bottom || panel.right <= box.left || panel.left >= box.right;
}
