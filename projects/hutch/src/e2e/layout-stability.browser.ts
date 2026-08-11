export interface MovedElement {
	element: string;
	offsets: number[];
}

export interface StabilityReport {
	sampled: number;
	moved: MovedElement[];
	pageHeights: number[];
}

export interface StabilityWindow {
	duration: number;
	interval: number;
}

/**
 * Samples every element's *layout* position for the length of the window.
 *
 * `offsetTop` rather than a bounding rect on purpose: it ignores transforms, so
 * an element the page deliberately animates in place — the hero's cross-fading
 * words — holds still by this measure, while anything that reflows the elements
 * after it does not. That is the difference between an animation and a layout
 * shift, and it is what lets the caller assert an exact count rather than pick a
 * threshold.
 */
export async function sampleLayoutStability(watched: StabilityWindow): Promise<StabilityReport> {
	const tracked: HTMLElement[] = [];
	const seen: Set<number>[] = [];
	for (const element of document.querySelectorAll("main *")) {
		if (element instanceof HTMLElement) {
			tracked.push(element);
			seen.push(new Set<number>());
		}
	}
	const pageHeights = new Set<number>();
	const deadline = performance.now() + watched.duration;
	let sampled = 0;
	while (performance.now() < deadline) {
		for (const [index, element] of tracked.entries()) seen[index].add(element.offsetTop);
		pageHeights.add(document.documentElement.scrollHeight);
		sampled++;
		await new Promise((resume) => setTimeout(resume, watched.interval));
	}
	const moved: MovedElement[] = [];
	for (const [index, element] of tracked.entries()) {
		const offsets = seen[index];
		if (offsets.size < 2) continue;
		const id = element.id === "" ? "" : `#${element.id}`;
		const classes = Array.from(element.classList).join(".");
		moved.push({
			element: `${element.tagName.toLowerCase()}${id}${classes === "" ? "" : `.${classes}`}`,
			offsets: Array.from(offsets),
		});
	}
	return { sampled, moved, pageHeights: Array.from(pageHeights) };
}
