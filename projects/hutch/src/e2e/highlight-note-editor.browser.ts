export interface ScreenBox {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

export function boxOfMarks(input: { marks: string }): ScreenBox {
	const rects = Array.from(document.querySelectorAll(input.marks)).flatMap((mark) => Array.from(mark.getClientRects()));
	if (rects.length === 0) throw new Error(`boxOfMarks needs ${input.marks}`);
	return {
		top: Math.min(...rects.map((rect) => rect.top)),
		bottom: Math.max(...rects.map((rect) => rect.bottom)),
		left: Math.min(...rects.map((rect) => rect.left)),
		right: Math.max(...rects.map((rect) => rect.right)),
	};
}

export function boxOfSelection(): ScreenBox {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) throw new Error("boxOfSelection needs a selection");
	const rects = Array.from(selection.getRangeAt(0).getClientRects());
	if (rects.length === 0) throw new Error("boxOfSelection needs a selection holding text");
	return {
		top: Math.min(...rects.map((rect) => rect.top)),
		bottom: Math.max(...rects.map((rect) => rect.bottom)),
		left: Math.min(...rects.map((rect) => rect.left)),
		right: Math.max(...rects.map((rect) => rect.right)),
	};
}

export function boxOfElement(input: { selector: string }): ScreenBox {
	const element = document.querySelector(input.selector);
	if (!element) throw new Error(`boxOfElement needs ${input.selector}`);
	const rect = element.getBoundingClientRect();
	return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
}

export function visualViewportBox(): ScreenBox {
	const viewport = window.visualViewport;
	if (!viewport) throw new Error("visualViewportBox needs a visual viewport");
	return {
		top: viewport.offsetTop,
		bottom: viewport.offsetTop + viewport.height,
		left: viewport.offsetLeft,
		right: viewport.offsetLeft + viewport.width,
	};
}

export function backdropOf(input: { selector: string }): { background: string; filter: string } {
	const element = document.querySelector(input.selector);
	if (!element) throw new Error(`backdropOf needs ${input.selector}`);
	const backdrop = getComputedStyle(element, "::backdrop");
	return { background: backdrop.backgroundColor, filter: backdrop.backdropFilter };
}

export function controlsMissedByAHit(input: { editor: string; controls: string }): string[] {
	const editor = document.querySelector(input.editor);
	if (!editor) throw new Error(`controlsMissedByAHit needs ${input.editor}`);
	const controls = Array.from(editor.querySelectorAll(input.controls));
	if (controls.length === 0) throw new Error(`controlsMissedByAHit needs ${input.controls}`);
	return controls.flatMap((control) => {
		const rect = control.getBoundingClientRect();
		const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
		const name = control.getAttribute("data-test-action") ?? control.tagName.toLowerCase();
		return hit !== null && control.contains(hit) ? [] : [`${name} hit ${hit === null ? "nothing" : hit.outerHTML.slice(0, 80)}`];
	});
}
