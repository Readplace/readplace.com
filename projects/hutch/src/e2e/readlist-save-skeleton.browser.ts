export interface DocumentBox {
	top: number;
	bottom: number;
	height: number;
	width: number;
}

export function measureDocumentBoxes(selectors: readonly string[]): DocumentBox[] {
	return selectors.map((selector) => {
		const element = document.querySelector(selector);
		if (!element) throw new Error(`"${selector}" must be laid out to be measured`);
		const rect = element.getBoundingClientRect();
		return {
			top: rect.top + window.scrollY,
			bottom: rect.bottom + window.scrollY,
			height: rect.height,
			width: rect.width,
		};
	});
}

export function pinSaveBarValue(input: { selector: string; value: string }): void {
	const field = document.querySelector<HTMLInputElement>(input.selector);
	if (!field) throw new Error(`"${input.selector}" must be rendered to pin its value`);
	field.value = input.value;
}
