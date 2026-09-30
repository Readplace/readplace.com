export function suppressVolatileAdminUi(input: { volatile: readonly string[]; seededYear: string; freshLabel: string }): void {
	for (const selector of input.volatile) document.querySelector(selector)?.remove();
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	for (const time of document.querySelectorAll("main time")) {
		if (!(time.getAttribute("datetime") ?? "").startsWith(input.seededYear)) time.textContent = input.freshLabel;
	}
}

export function statusBadgeLineCounts(selector: string): number[] {
	return Array.from(document.querySelectorAll(selector), (badge) => {
		const range = document.createRange();
		range.selectNodeContents(badge);
		return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
	});
}
