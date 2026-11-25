interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export function rowActionBoxes(input: { row: string }): { row: Box; buttons: Box[] } {
	const row = document.querySelector(input.row);
	if (!row) throw new Error(`rowActionBoxes needs ${input.row}`);
	const boxOf = (element: Element): Box => {
		const rect = element.getBoundingClientRect();
		return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
	};
	return {
		row: boxOf(row),
		buttons: Array.from(row.querySelectorAll(".highlights-rail__actions > .btn, .highlights-rail__actions > form .btn"))
			.filter((button) => button.getBoundingClientRect().width > 0)
			.map(boxOf),
	};
}
