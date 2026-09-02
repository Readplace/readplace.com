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

export function measureBackgrounds(selectors: readonly string[]): string[] {
	return selectors.map((selector) => {
		const element = document.querySelector(selector);
		if (!element) throw new Error(`"${selector}" must be laid out to be measured`);
		return getComputedStyle(element).backgroundColor;
	});
}

export function measureInks(selectors: readonly string[]): string[] {
	return selectors.map((selector) => {
		const element = document.querySelector(selector);
		if (!element) throw new Error(`"${selector}" must be laid out to be measured`);
		return getComputedStyle(element).color;
	});
}

export function measureRenameRing(input: {
	editing: string;
	item: string;
	trigger: string;
	list: string;
	reach: number;
}): {
	ring: { left: number; top: number; right: number; bottom: number };
	scroller: { left: number; top: number; right: number; bottom: number };
	legs: { x: number; y: number; paintedBy: string }[];
	ringShadow: string;
	pageBackground: string;
	ringColour: string;
} {
	const editing = document.querySelector(input.editing);
	if (!editing) throw new Error(`"${input.editing}" must be laid out to be measured`);
	const item = editing.closest(input.item);
	if (!item) throw new Error(`"${input.editing}" must sit inside "${input.item}" to be measured`);
	const trigger = item.querySelector(input.trigger);
	const list = document.querySelector(input.list);
	if (!trigger || !list) throw new Error(`"${input.trigger}" and "${input.list}" must be laid out to be measured`);
	const itemRect = item.getBoundingClientRect();
	const triggerRect = trigger.getBoundingClientRect();
	const ring = {
		left: Math.min(itemRect.left, triggerRect.left) - input.reach,
		top: Math.min(itemRect.top, triggerRect.top) - input.reach,
		right: Math.max(itemRect.right, triggerRect.right) + input.reach,
		bottom: Math.max(itemRect.bottom, triggerRect.bottom) + input.reach,
	};
	const listRect = list.getBoundingClientRect();
	const scroller = {
		left: listRect.left,
		top: listRect.top,
		right: listRect.right,
		bottom: listRect.bottom,
	};
	const cx = (ring.left + ring.right) / 2;
	const cy = (ring.top + ring.bottom) / 2;
	const legs = [
		{ x: cx, y: ring.top + 1 },
		{ x: cx, y: ring.bottom - 1 },
		{ x: ring.left + 1, y: cy },
		{ x: ring.right - 1, y: cy },
	].map(({ x, y }) => {
		const hit = document.elementFromPoint(x, y);
		if (!hit) throw new Error(`nothing is painted at (${x}, ${y}) to be measured`);
		const navLabel = hit.closest("nav")?.getAttribute("aria-label");
		return { x, y, paintedBy: navLabel ?? `${hit.tagName}.${hit.classList.value}` };
	});
	const probe = document.createElement("span");
	probe.style.color = "var(--ring)";
	document.body.append(probe);
	const ringColour = getComputedStyle(probe).color;
	probe.remove();
	return {
		ring,
		scroller,
		legs,
		ringShadow: getComputedStyle(item, "::after").boxShadow,
		pageBackground: getComputedStyle(document.body).backgroundColor,
		ringColour,
	};
}

export function pageOverflowsSideways(): boolean {
	return document.documentElement.scrollWidth > document.documentElement.clientWidth;
}

export function neutraliseVolatileChrome(input: {
	volatile: readonly string[];
	times: readonly string[];
}): void {
	for (const selector of input.volatile) document.querySelector(selector)?.remove();
	const times = document.querySelectorAll(".readlist-article__time");
	for (const [index, time] of times.entries()) {
		time.textContent = input.times[index] ?? "";
	}
}
