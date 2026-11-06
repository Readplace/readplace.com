export function selectPassage(input: { root: string; exact: string }): void {
	const root = document.querySelector(input.root);
	if (!root) throw new Error(`selectPassage needs ${input.root}`);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const at = (node.textContent ?? "").indexOf(input.exact);
		if (at < 0) continue;
		const range = document.createRange();
		range.setStart(node, at);
		range.setEnd(node, at + input.exact.length);
		const selection = window.getSelection();
		if (!selection) throw new Error("selectPassage needs a document selection");
		selection.removeAllRanges();
		selection.addRange(range);
		return;
	}
	throw new Error(`selectPassage found no text node holding "${input.exact}"`);
}
