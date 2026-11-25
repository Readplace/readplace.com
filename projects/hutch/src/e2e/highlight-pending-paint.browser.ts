export const PENDING_HIGHLIGHT_NAME = "highlight-pending";
export const PENDING_PAINT_STAMP = "data-test-pending-paint";

export interface PendingPaintProbe {
	quote: string;
	styled: boolean;
	status: string;
	rect: { x: number; y: number; width: number; height: number } | null;
}

export function armPendingPaintProbe(input: { button: string; status: string; name: string; stamp: string }): void {
	const button = document.querySelector(input.button);
	if (!button) throw new Error(`armPendingPaintProbe needs ${input.button}`);
	const styledRule = (): boolean =>
		Array.from(document.styleSheets).some((sheet) => {
			try {
				return Array.from(sheet.cssRules).some(
					(rule) =>
						rule instanceof CSSStyleRule &&
						rule.selectorText.includes(`::highlight(${input.name})`) &&
						rule.style.backgroundColor !== "",
				);
			} catch {
				return false;
			}
		});
	button.addEventListener(
		"click",
		() => {
			requestAnimationFrame(() => {
				const painted = CSS.highlights.get(input.name);
				const ranges = painted === undefined ? [] : Array.from(painted).filter((range) => range instanceof Range);
				const first = ranges[0];
				const box = first === undefined ? null : first.getClientRects()[0];
				const probe: PendingPaintProbe = {
					quote: ranges.map((range) => range.toString()).join(""),
					styled: styledRule(),
					status: document.querySelector(input.status)?.textContent?.trim() ?? "",
					rect: box === undefined || box === null ? null : { x: box.x, y: box.y, width: box.width, height: box.height },
				};
				document.documentElement.setAttribute(input.stamp, JSON.stringify(probe));
			});
		},
		{ once: true },
	);
}

export function firstLineRectOf(input: { root: string; exact: string }): { x: number; y: number; width: number; height: number } {
	const root = document.querySelector(input.root);
	if (!root) throw new Error(`firstLineRectOf needs ${input.root}`);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const at = (node.textContent ?? "").indexOf(input.exact);
		if (at < 0) continue;
		const range = document.createRange();
		range.setStart(node, at);
		range.setEnd(node, at + input.exact.length);
		const box = range.getClientRects()[0];
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	}
	throw new Error(`firstLineRectOf found no text node holding "${input.exact}"`);
}

export async function tintedShare(input: { png: string; root: string }): Promise<number> {
	const image = new Image();
	image.src = `data:image/png;base64,${input.png}`;
	await image.decode();
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("tintedShare needs a 2d canvas");
	context.drawImage(image, 0, 0);
	let surface: Element | null = document.querySelector(input.root);
	let background: number[] | undefined;
	while (surface !== null && background === undefined) {
		const channels = getComputedStyle(surface).backgroundColor.match(/\d+(\.\d+)?/g)?.map(Number);
		if (channels !== undefined && (channels.length === 3 || channels[3] === 1)) background = channels;
		surface = surface.parentElement;
	}
	if (background === undefined) throw new Error(`tintedShare found no opaque background behind ${input.root}`);
	const [r, g, b] = background;
	const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
	let tinted = 0;
	for (let index = 0; index < data.length; index += 4) {
		const distance = Math.abs(data[index] - r) + Math.abs(data[index + 1] - g) + Math.abs(data[index + 2] - b);
		if (distance > 12) tinted += 1;
	}
	return tinted / (data.length / 4);
}

export function passageEdges(input: { root: string; exact: string }): { start: { x: number; y: number }; end: { x: number; y: number } } {
	const root = document.querySelector(input.root);
	if (!root) throw new Error(`passageEdges needs ${input.root}`);
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const at = (node.textContent ?? "").indexOf(input.exact);
		if (at < 0) continue;
		const first = document.createRange();
		first.setStart(node, at);
		first.setEnd(node, at + 1);
		const last = document.createRange();
		last.setStart(node, at + input.exact.length - 1);
		last.setEnd(node, at + input.exact.length);
		const a = first.getBoundingClientRect();
		const b = last.getBoundingClientRect();
		return { start: { x: a.left + 1, y: a.top + a.height / 2 }, end: { x: b.right - 1, y: b.top + b.height / 2 } };
	}
	throw new Error(`passageEdges found no text node holding "${input.exact}"`);
}
