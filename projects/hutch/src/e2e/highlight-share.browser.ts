export function withoutWebShare(): void {
	Reflect.deleteProperty(Navigator.prototype, "share");
	Reflect.deleteProperty(navigator, "share");
}

export function withWebShare(): void {
	Object.defineProperty(Navigator.prototype, "share", {
		configurable: true,
		value: () => Promise.resolve(),
	});
}

export function passageInViewport(input: { root: string; exact: string }): boolean {
	const root = document.querySelector(input.root);
	if (!root) throw new Error(`passageInViewport needs ${input.root}`);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const at = (node.textContent ?? "").indexOf(input.exact);
		if (at < 0) continue;
		const range = document.createRange();
		range.setStart(node, at);
		range.setEnd(node, at + input.exact.length);
		const rect = range.getBoundingClientRect();
		return rect.top >= 0 && rect.bottom <= window.innerHeight;
	}
	throw new Error(`passageInViewport found no text node holding "${input.exact}"`);
}
