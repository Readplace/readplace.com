export interface RenderedInk {
	name: string;
	role: "text" | "graphic" | "fill";
	ink: { red: number; green: number; blue: number };
	surface: { red: number; green: number; blue: number };
	fontSizePx: number;
	fontWeight: number;
}

export function collectRenderedInk(rootSelector: string): RenderedInk[] {
	/* A queue tab is an anchor, but it paints an opaque brand fill and carries its
	 * label on that fill exactly as a button does, so it is audited as a filled
	 * control rather than as text on a surface. */
	const FILLED_CONTROL = "button, .btn, .queue-nav__link";
	const OPAQUE = 1;
	const TRANSPARENT = 0;
	const HAIRLINE_PX = 1;

	interface Rgba {
		red: number;
		green: number;
		blue: number;
		alpha: number;
	}

	function parseColour(value: string): Rgba {
		const channels = value.match(/-?[\d.]+/g);
		if (!channels || channels.length < 3) {
			throw new Error(`cannot read "${value}" as an rgb()/rgba() colour`);
		}
		return {
			red: Number(channels[0]),
			green: Number(channels[1]),
			blue: Number(channels[2]),
			alpha: channels.length > 3 ? Number(channels[3]) : OPAQUE,
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

	function opaqueBackdrop(start: Element): Element | null {
		let node: Element | null = start;
		while (node) {
			if (parseColour(getComputedStyle(node).backgroundColor).alpha === OPAQUE) return node;
			node = node.parentElement;
		}
		return null;
	}

	function nameOf(el: Element): string {
		const testAttribute = Array.from(el.attributes).find((attribute) =>
			attribute.name.startsWith("data-test"),
		);
		if (testAttribute) {
			return testAttribute.value
				? `${testAttribute.name}="${testAttribute.value}"`
				: `[${testAttribute.name}]`;
		}
		const classes = (el.getAttribute("class") ?? "")
			.trim()
			.split(/\s+/)
			.filter((name) => name && !name.startsWith("htmx-"));
		const tag = el.tagName.toLowerCase();
		return classes.length ? `${tag}.${classes.join(".")}` : tag;
	}

	function withoutAlpha(colour: Rgba): { red: number; green: number; blue: number } {
		return { red: colour.red, green: colour.green, blue: colour.blue };
	}

	const root = document.querySelector(rootSelector);
	if (!root) throw new Error(`the page must render "${rootSelector}"`);

	const collected: RenderedInk[] = [];

	for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
		const style = getComputedStyle(el);
		const box = el.getBoundingClientRect();
		const rendered =
			box.width > HAIRLINE_PX &&
			box.height > HAIRLINE_PX &&
			style.visibility === "visible" &&
			style.opacity !== "0";
		if (!rendered) continue;

		const fontSizePx = Number.parseFloat(style.fontSize);
		const fontWeight = Number(style.fontWeight);
		const ownBackground = parseColour(style.backgroundColor);

		if (el.matches(FILLED_CONTROL) && ownBackground.alpha === OPAQUE) {
			const behind = surfaceUnder(el.parentElement);
			collected.push({
				name: nameOf(el),
				role: "fill",
				ink: withoutAlpha(flatten({ over: ownBackground, under: behind })),
				surface: withoutAlpha(behind),
				fontSizePx,
				fontWeight,
			});
			continue;
		}

		const ownText = Array.from(el.childNodes)
			.filter((node) => node.nodeType === Node.TEXT_NODE)
			.map((node) => (node.textContent ?? "").trim())
			.filter(Boolean)
			.join(" ");
		const paintsIcon = el.querySelector(":scope > svg") !== null;
		const marker = getComputedStyle(el, "::before");
		const paintsShape =
			marker.content !== "none" &&
			parseColour(marker.backgroundColor).alpha > TRANSPARENT &&
			Number.parseFloat(marker.width) > 0;
		if (!ownText && !paintsIcon && !paintsShape) continue;

		const backdrop = opaqueBackdrop(el);
		if (backdrop?.matches(FILLED_CONTROL)) continue;

		const surface = surfaceUnder(el);
		collected.push({
			name: nameOf(el),
			role: ownText ? "text" : "graphic",
			ink: withoutAlpha(flatten({ over: parseColour(style.color), under: surface })),
			surface: withoutAlpha(surface),
			fontSizePx,
			fontWeight,
		});
	}
	return collected;
}
