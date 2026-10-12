export interface MeasuredBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function measureBoxes(selectors: readonly string[]): MeasuredBox[] {
	return selectors.map((selector) => {
		const element = document.querySelector(selector);
		if (!element) throw new Error(`"${selector}" must be laid out to be measured`);
		const { x, y, width, height } = element.getBoundingClientRect();
		return { x, y, width, height };
	});
}

export interface TextFit {
	needed: number;
	painted: number;
	height: number;
}

export function measureTextFit(selector: string): TextFit {
	const element = document.querySelector(selector);
	if (!element) throw new Error(`"${selector}" must be laid out to be measured`);
	return { needed: element.scrollWidth, painted: element.clientWidth, height: element.getBoundingClientRect().height };
}

export function resolveColourTokens(tokens: readonly string[]): string[] {
	const probe = document.createElement("span");
	document.body.append(probe);
	const colours = tokens.map((token) => {
		probe.style.color = `var(${token})`;
		return getComputedStyle(probe).color;
	});
	probe.remove();
	return colours;
}

export function pageOverflowsSideways(): boolean {
	return document.documentElement.scrollWidth > document.documentElement.clientWidth;
}

export function neutraliseVolatileChrome(input: {
	volatile: readonly string[];
	times: readonly string[];
}): void {
	for (const selector of input.volatile) document.querySelector(selector)?.remove();
	const times = document.querySelectorAll(".readlist-article__time");
	for (const [index, time] of times.entries()) {
		time.textContent = input.times[index] ?? "";
	}
}
