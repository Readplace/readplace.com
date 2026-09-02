export interface InteractionInk {
	name: string;
	text: { red: number; green: number; blue: number };
	fill: { red: number; green: number; blue: number };
	surface: { red: number; green: number; blue: number };
	borders: {
		colour: { red: number; green: number; blue: number };
		width: number;
		style: string;
	}[];
	visibleBoundaryColours: { red: number; green: number; blue: number }[];
	outline: {
		colour: { red: number; green: number; blue: number };
		width: number;
		style: string;
		offset: number;
	};
	boxShadow: string;
	fontSizePx: number;
	fontWeight: number;
}

export function collectInteractionInk(auditId: string): InteractionInk {
	const OPAQUE = 1;
	const TRANSPARENT = 0;
	const UNIT_MAX = 255;

	interface Rgba {
		red: number;
		green: number;
		blue: number;
		alpha: number;
	}

	function parseColour(value: string): Rgba {
		const numbers = value.match(/-?[\d.]+/g);
		if (!numbers || numbers.length < 3) {
			throw new Error(`cannot read "${value}" as a colour`);
		}
		const scale = value.startsWith("color(") ? UNIT_MAX : 1;
		return {
			red: Number(numbers[0]) * scale,
			green: Number(numbers[1]) * scale,
			blue: Number(numbers[2]) * scale,
			alpha: numbers.length > 3 ? Number(numbers[3]) : OPAQUE,
		};
	}

	function flatten(layers: { over: Rgba; under: Rgba }): Rgba {
		const { over, under } = layers;
		return {
			red: over.alpha * over.red + (1 - over.alpha) * under.red,
			green: over.alpha * over.green + (1 - over.alpha) * under.green,
			blue: over.alpha * over.blue + (1 - over.alpha) * under.blue,
			alpha: OPAQUE,
		};
	}

	function canvasColour(): Rgba {
		const probe = document.createElement("div");
		probe.style.setProperty("background-color", "var(--background)");
		document.documentElement.appendChild(probe);
		const resolved = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return parseColour(resolved);
	}

	const canvas = canvasColour();

	function surfaceUnder(start: Element | null): Rgba {
		const layers: Rgba[] = [];
		let node = start;
		while (node) {
			const layer = parseColour(getComputedStyle(node).backgroundColor);
			if (layer.alpha > TRANSPARENT) layers.push(layer);
			if (layer.alpha === OPAQUE) break;
			node = node.parentElement;
		}
		return layers.reduceRight((under, over) => flatten({ over, under }), canvas);
	}

	function channelsOf(colour: Rgba): { red: number; green: number; blue: number } {
		return { red: colour.red, green: colour.green, blue: colour.blue };
	}

	const element = document.querySelector(`[data-audit-id="${auditId}"]`);
	if (!element) throw new Error(`the page must render [data-audit-id="${auditId}"]`);
	const style = getComputedStyle(element);

	const behind = surfaceUnder(element.parentElement);
	const fill = flatten({ over: parseColour(style.backgroundColor), under: behind });
	const text = flatten({ over: parseColour(style.color), under: fill });

	const borders = ["top", "right", "bottom", "left"].map((side) => ({
		colour: channelsOf(parseColour(style.getPropertyValue(`border-${side}-color`))),
		width: Number.parseFloat(style.getPropertyValue(`border-${side}-width`)),
		style: style.getPropertyValue(`border-${side}-style`),
	}));

	const outline = {
		colour: channelsOf(parseColour(style.outlineColor)),
		width: Number.parseFloat(style.outlineWidth),
		style: style.outlineStyle,
		offset: Number.parseFloat(style.outlineOffset),
	};

	const visibleBoundaryColours: { red: number; green: number; blue: number }[] = [];
	for (const edge of borders) {
		if (edge.width > 0 && edge.style !== "none") visibleBoundaryColours.push(edge.colour);
	}
	if (outline.width > 0 && outline.style !== "none") visibleBoundaryColours.push(outline.colour);

	return {
		name: `[data-audit-id="${auditId}"]`,
		text: channelsOf(text),
		fill: channelsOf(fill),
		surface: channelsOf(behind),
		borders,
		visibleBoundaryColours,
		outline,
		boxShadow: style.boxShadow,
		fontSizePx: Number.parseFloat(style.fontSize),
		fontWeight: Number(style.fontWeight),
	};
}
