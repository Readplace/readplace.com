export interface ReadlistMoreDeps {
	document: Document;
}

const SWITCH = "[data-readlist-switch]";
const FILTER = "[data-readlist-switch-filter]";
const BODY = "[data-readlist-switch-body]";
const ENTRY = "[data-readlist-switch-entry]";
const EMPTY = "[data-readlist-switch-empty]";
const LABEL = ".readlist-more__label";
const CURRENT = 'a[aria-current="page"]';
const FILTERING = "readlist-more__head--filtering";
const RAIL = ".readlist__rail";
const RAIL_LIST = ".readlist-nav__rail-list";
const LAYOUT = ".readlist__layout";
const MENU = ".readlist-nav__menu";
const MENU_UP = "readlist-nav__menu--up";
const MENU_FLOATING = "readlist-nav__menu--floating";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function partsOf(dialog: Element): {
	filter: HTMLInputElement;
	body: Element;
	empty: Element;
} {
	const filter = dialog.querySelector<HTMLInputElement>(FILTER);
	const body = dialog.querySelector(BODY);
	const empty = dialog.querySelector(EMPTY);
	assert(
		filter && body && empty,
		"a readlist switch carries its filter, body and status",
	);
	return { filter, body, empty };
}

function applyFilter(dialog: Element): void {
	const { filter, empty } = partsOf(dialog);
	const query = filter.value.trim().toLocaleLowerCase();
	let shown = 0;
	for (const entry of dialog.querySelectorAll<HTMLElement>(ENTRY)) {
		const label = entry.querySelector(LABEL);
		assert(label, "every readlist switch entry carries its label");
		entry.hidden = !String(label.textContent)
			.toLocaleLowerCase()
			.includes(query);
		if (!entry.hidden) shown += 1;
	}
	empty.textContent =
		shown === 0 ? String(empty.getAttribute("data-no-match")) : "";
}

function placeBesideRail(input: {
	document: Document;
	window: Window;
	dialog: HTMLElement;
}): void {
	const railList = input.document.querySelector(RAIL_LIST);
	const layout = input.document.querySelector(LAYOUT);
	assert(railList && layout, "a readlist switch sits beside the readlist rail");
	const gap = Number.parseFloat(
		input.window.getComputedStyle(layout).columnGap,
	);
	input.dialog.style.setProperty(
		"--readlist-more-left",
		`${railList.getBoundingClientRect().right + gap}px`,
	);
}

function onSwitchToggle(input: {
	document: Document;
	window: Window;
	dialog: HTMLElement;
	open: boolean;
}): void {
	const { dialog } = input;
	for (const opener of input.document.querySelectorAll(
		`[popovertarget="${dialog.id}"]:not([popovertargetaction="hide"])`,
	)) {
		opener.setAttribute("aria-expanded", String(input.open));
	}
	const { filter, body } = partsOf(dialog);
	const head = filter.parentElement;
	assert(head, "the filter sits in its popover's head");
	filter.value = "";
	applyFilter(dialog);
	filter.hidden = true;
	head.classList.remove(FILTERING);
	if (!input.open) return;
	placeBesideRail(input);
	if (body.scrollHeight > body.clientHeight + 1) {
		filter.hidden = false;
		head.classList.add(FILTERING);
		if (input.window.matchMedia("(pointer: fine)").matches)
			filter.focus({ preventScroll: true });
	}
	for (const current of dialog.querySelectorAll(CURRENT))
		current.scrollIntoView({ block: "nearest" });
}

function placeMenu(input: { window: Window; menu: HTMLDetailsElement }): void {
	const { menu } = input;
	menu.classList.remove(MENU_UP, MENU_FLOATING);
	const panel = menu.querySelector<HTMLElement>(".menu__panel");
	assert(panel, "a rail menu opens a panel");
	const toggle = menu.getBoundingClientRect();
	const height = panel.getBoundingClientRect().height;
	const below = input.window.innerHeight - toggle.bottom;
	const above = toggle.top;
	const up = height > below && above > below;
	if (menu.closest(SWITCH) === null) {
		if (up) menu.classList.add(MENU_UP);
		return;
	}
	menu.classList.add(MENU_FLOATING);
	const top = up ? toggle.top - height : toggle.bottom;
	const left = toggle.right - panel.getBoundingClientRect().width;
	panel.style.setProperty("--menu-top", `${top}px`);
	panel.style.setProperty("--menu-left", `${left}px`);
	const placed = panel.getBoundingClientRect();
	panel.style.setProperty("--menu-top", `${2 * top - placed.top}px`);
	panel.style.setProperty("--menu-left", `${2 * left - placed.left}px`);
}

export function initReadlistMore(deps: ReadlistMoreDeps): void {
	const window = deps.document.defaultView;
	assert(window, "the readlist switch runs in a window");
	const open = new WeakSet<Element>();

	deps.document.addEventListener(
		"toggle",
		(event) => {
			const target = event.target;
			if (!isElement(target)) return;
			const menu = target.closest<HTMLDetailsElement>(`${RAIL} details${MENU}`);
			if (menu === target) {
				if (menu.open) placeMenu({ window, menu });
				return;
			}
			const dialog = target.closest<HTMLElement>(SWITCH);
			if (dialog !== target) return;
			const isOpen = Reflect.get(event, "newState") === "open";
			if (isOpen) open.add(dialog);
			else open.delete(dialog);
			onSwitchToggle({ document: deps.document, window, dialog, open: isOpen });
		},
		true,
	);

	deps.document.addEventListener(
		"scroll",
		(event) => {
			const body = event.target;
			if (!isElement(body) || !body.matches(BODY)) return;
			for (const menu of body.querySelectorAll<HTMLDetailsElement>(
				`details${MENU}[open]`,
			))
				menu.open = false;
		},
		true,
	);

	deps.document.addEventListener("input", (event) => {
		const target = event.target;
		if (!isElement(target) || !target.matches(FILTER)) return;
		const dialog = target.closest(SWITCH);
		assert(dialog, "a readlist filter sits inside its switch");
		applyFilter(dialog);
	});

	deps.document.addEventListener("keydown", (event) => {
		const target = event.target;
		if (event.key !== "Enter" || !isElement(target) || !target.matches(FILTER))
			return;
		event.preventDefault();
		const dialog = target.closest(SWITCH);
		assert(dialog, "a readlist filter sits inside its switch");
		if (partsOf(dialog).filter.value.trim() === "") return;
		const first = dialog.querySelector<HTMLElement>(`${ENTRY}:not([hidden]) a`);
		if (first !== null) first.click();
	});

	deps.document.addEventListener("focusout", (event) => {
		const target = event.target;
		const dialog = isElement(target)
			? target.closest<HTMLElement>(SWITCH)
			: null;
		const to = event.relatedTarget;
		if (
			dialog === null ||
			!open.has(dialog) ||
			!isElement(to) ||
			dialog.contains(to)
		)
			return;
		if (to.closest("[popover]") !== null) return;
		dialog.hidePopover();
	});
}
