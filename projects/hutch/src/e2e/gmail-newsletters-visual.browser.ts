export function blockTimerPolls(): void {
	document.addEventListener("htmx:beforeRequest", (event) => {
		const trigger = event.target instanceof Element ? event.target.getAttribute("hx-trigger") : null;
		if (trigger?.startsWith("every")) event.preventDefault();
	});
}

export function removeVolatileChrome(volatile: readonly string[]): void {
	for (const selector of volatile) document.querySelector(selector)?.remove();
	if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function mappingRouteGaps(rows: Element[]): number[] {
	return rows.map((row) => {
		const source = row.querySelector(".gmail-mappings__source");
		const arrow = row.querySelector(".gmail-mappings__arrow");
		if (!source || !arrow) throw new Error("every mapping row renders its source and arrow");
		return arrow.getBoundingClientRect().top - source.getBoundingClientRect().bottom;
	});
}

export function documentHeight(): number {
	return document.documentElement.scrollHeight;
}
