export function suppressVolatileChrome(volatile: readonly string[]): void {
	for (const selector of volatile) document.querySelector(selector)?.remove();
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
