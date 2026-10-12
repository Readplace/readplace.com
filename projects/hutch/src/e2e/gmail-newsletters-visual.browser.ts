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

export function scrollToTop(): void {
	window.scrollTo(0, 0);
}

export interface ScrollBoxMeasure {
	height: number;
	maxHeight: number;
	overflowY: string;
	scrollHeight: number;
	clientHeight: number;
	scrollWidth: number;
	clientWidth: number;
}

export function measureScrollBox(selector: string): ScrollBoxMeasure {
	const element = document.querySelector(selector);
	if (!(element instanceof HTMLElement)) throw new Error(`"${selector}" must be laid out to be measured`);
	const style = getComputedStyle(element);
	return {
		height: element.getBoundingClientRect().height,
		maxHeight: Number.parseFloat(style.maxHeight),
		overflowY: style.overflowY,
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
		scrollWidth: element.scrollWidth,
		clientWidth: element.clientWidth,
	};
}

export function scrollBoxTo(input: { selector: string; top: number }): void {
	const element = document.querySelector(input.selector);
	if (!element) throw new Error(`"${input.selector}" must exist to be scrolled`);
	element.scrollTop = input.top;
}
