export function suppressVolatileChrome(volatile: readonly string[]): void {
	for (const selector of volatile) document.querySelector(selector)?.remove();
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function pageOverflowsSideways(): boolean {
	return document.documentElement.scrollWidth > document.documentElement.clientWidth;
}

export function documentHeight(): number {
	return document.documentElement.scrollHeight;
}
