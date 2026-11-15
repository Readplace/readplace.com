export interface FloatingMenuDeps {
	document: Document;
}

const MENU = "details.menu";
const PANEL = ".menu__panel";
const FLOATING = "menu--floating";

interface TogglePosition {
	top: number;
	left: number;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function floatMenu(input: {
	window: Window;
	menu: HTMLDetailsElement;
	placed: WeakMap<HTMLDetailsElement, TogglePosition>;
}): void {
	const { menu } = input;
	menu.classList.remove(FLOATING);
	const panel = menu.querySelector<HTMLElement>(PANEL);
	assert(panel, "a menu opens a panel");
	const toggle = menu.getBoundingClientRect();
	const resting = panel.getBoundingClientRect();
	const below = input.window.innerHeight - toggle.bottom;
	const up =
		resting.top + resting.height > input.window.innerHeight &&
		toggle.top > below;
	const gap = resting.top - toggle.bottom;
	const top = up ? toggle.top - gap - resting.height : resting.top;
	const left = resting.left;
	input.placed.set(menu, { top: toggle.top, left: toggle.left });
	menu.classList.add(FLOATING);
	panel.style.setProperty("--menu-top", `${top}px`);
	panel.style.setProperty("--menu-left", `${left}px`);
	const floated = panel.getBoundingClientRect();
	panel.style.setProperty("--menu-top", `${2 * top - floated.top}px`);
	panel.style.setProperty("--menu-left", `${2 * left - floated.left}px`);
}

export function initFloatingMenus(deps: FloatingMenuDeps): void {
	const window = deps.document.defaultView;
	assert(window, "floating menus run in a window");
	const placed = new WeakMap<HTMLDetailsElement, TogglePosition>();

	const closeMovedMenus = (): void => {
		for (const menu of deps.document.querySelectorAll<HTMLDetailsElement>(
			`${MENU}[open]`,
		)) {
			const at = placed.get(menu);
			if (at === undefined) continue;
			const now = menu.getBoundingClientRect();
			if (at.top !== now.top || at.left !== now.left) menu.open = false;
		}
	};

	deps.document.addEventListener(
		"toggle",
		(event) => {
			const target = event.target;
			if (!isElement(target)) return;
			const menu = target.closest<HTMLDetailsElement>(MENU);
			if (menu !== target) return;
			if (menu.open) {
				floatMenu({ window, menu, placed });
				return;
			}
			placed.delete(menu);
			menu.classList.remove(FLOATING);
		},
		true,
	);
	deps.document.addEventListener("scroll", closeMovedMenus, true);
	deps.document.addEventListener("htmx:afterSettle", closeMovedMenus);
	window.addEventListener("resize", closeMovedMenus);
}
