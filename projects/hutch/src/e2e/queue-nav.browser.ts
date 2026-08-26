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

export function measureNameSize(input: { label: string; tab: string }): {
	fontSize: string;
	width: number;
	height: number;
} {
	const label = document.querySelector(input.label);
	const tab = document.querySelector(input.tab);
	if (!label || !tab) throw new Error(`"${input.label}" and "${input.tab}" must be laid out to be measured`);
	const { width, height } = tab.getBoundingClientRect();
	return { fontSize: getComputedStyle(label).fontSize, width, height };
}

export function pageOverflowsSideways(): boolean {
	return document.documentElement.scrollWidth > document.documentElement.clientWidth;
}

export function neutraliseVolatileChrome(input: {
	volatile: readonly string[];
	times: readonly string[];
}): void {
	for (const selector of input.volatile) document.querySelector(selector)?.remove();
	const times = document.querySelectorAll(".queue-article__time");
	for (const [index, time] of times.entries()) {
		time.textContent = input.times[index] ?? "";
	}
}
