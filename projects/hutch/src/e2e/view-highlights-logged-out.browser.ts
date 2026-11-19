export function toolbarAgainstViewCta(input: { toolbar: string; cta: string }): {
	gapFromSelection: number;
	overlapsCta: boolean;
} {
	const toolbar = document.querySelector(input.toolbar);
	const cta = document.querySelector(input.cta);
	if (!toolbar || !cta) throw new Error(`the toolbar check needs ${input.toolbar} and ${input.cta}`);
	const bar = toolbar.getBoundingClientRect();
	const floor = cta.getBoundingClientRect();
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) throw new Error("the toolbar check needs a selection");
	const rects = selection.getRangeAt(0).getClientRects();
	const first = rects[0];
	const last = rects[rects.length - 1];
	if (!first || !last) throw new Error("the toolbar check needs a selection holding text");
	return {
		gapFromSelection: bar.top >= last.bottom ? bar.top - last.bottom : first.top - bar.bottom,
		overlapsCta: bar.bottom > floor.top && bar.top < floor.bottom,
	};
}

export function scrollTextAboveCta(input: { root: string; exact: string; cta: string; gap: number }): void {
	const root = document.querySelector(input.root);
	const cta = document.querySelector(input.cta);
	if (!root || !cta) throw new Error(`scrollTextAboveCta needs ${input.root} and ${input.cta}`);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const at = (node.textContent ?? "").indexOf(input.exact);
		if (at < 0) continue;
		const range = document.createRange();
		range.setStart(node, at);
		range.setEnd(node, at + input.exact.length);
		const offset = range.getBoundingClientRect().bottom - (cta.getBoundingClientRect().top - input.gap);
		window.scrollBy({ top: offset, behavior: "instant" });
		return;
	}
	throw new Error(`scrollTextAboveCta found no text node holding "${input.exact}"`);
}

