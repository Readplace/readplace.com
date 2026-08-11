export interface ReservedHeadingProbe {
	/** The element carrying the reservation — its `--*-lines` custom property and
	 * line-height are what the reserved box is computed from. */
	title: string;
	/** The element whose line boxes make up the visible text. Naming the title
	 * itself is valid: the reservation fixes the title's own height, so only a
	 * range over its contents reports how far the text actually runs. */
	content: string;
	/** The first thing after the heading, whose distance from the heading's top
	 * is what a reader sees move when the reservation fails. */
	below: string;
	linesProperty: string;
}

export interface ReservedHeadingGeometry {
	reservedLines: number;
	reservedHeight: number;
	titleHeight: number;
	contentHeight: number;
	contentLines: number;
	belowOffset: number;
}

export function measureReservedHeading(probe: ReservedHeadingProbe): ReservedHeadingGeometry {
	const title = document.querySelector(probe.title);
	const content = document.querySelector(probe.content);
	const below = document.querySelector(probe.below);
	if (!title || !content || !below) {
		throw new Error(
			`the reserved-heading guard needs "${probe.title}", "${probe.content}" and "${probe.below}" to all be laid out`,
		);
	}
	const style = getComputedStyle(title);
	const lineHeight = Number.parseFloat(style.lineHeight);
	const reservedLines = Number(style.getPropertyValue(probe.linesProperty));
	const titleBox = title.getBoundingClientRect();
	const runs = document.createRange();
	runs.selectNodeContents(content);
	const contentHeight = runs.getBoundingClientRect().height;
	return {
		reservedLines,
		reservedHeight: lineHeight * reservedLines,
		titleHeight: titleBox.height,
		contentHeight,
		contentLines: Math.round(contentHeight / lineHeight),
		belowOffset: below.getBoundingClientRect().top - titleBox.top,
	};
}
