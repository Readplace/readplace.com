export function pinCopyableAddresses(address: string): void {
	for (const input of document.querySelectorAll("input[data-inbox-address]")) {
		if (!(input instanceof HTMLInputElement)) throw new Error("a copyable address must render as an input");
		input.value = address;
	}
}

export function centreOfElement(element: Element): { x: number; y: number; hitsElement: boolean } {
	const box = element.getBoundingClientRect();
	const x = box.left + box.width / 2;
	const y = box.top + box.height / 2;
	return { x, y, hitsElement: element.contains(document.elementFromPoint(x, y)) };
}
