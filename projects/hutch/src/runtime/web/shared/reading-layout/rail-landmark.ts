export interface RailLandmark {
	tag: "aside" | "div";
	attributes: { name: "aria-label"; value: string }[];
}

export function railLandmarkFor(input: { hasCard: boolean }): RailLandmark {
	return input.hasCard
		? { tag: "aside", attributes: [{ name: "aria-label", value: "Article details" }] }
		: { tag: "div", attributes: [] };
}
