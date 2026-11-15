export interface ReadlistPickerDeps {
	document: Document;
}

const PICKER = ".article-body__readlists";
const TRIGGER = ".article-body__readlists-trigger";
const OPTION = ".article-body__readlists-form .article-body__readlists-option";
const MENU = ".article-body__readlists-menu";
const SHEET = "article-body__readlists-menu--sheet";
const GAP_BELOW_MENU = 16;
const MIN_MENU_HEIGHT = 233;

function fitMenu(input: { menu: HTMLElement; viewportHeight: number }): void {
	input.menu.classList.remove(SHEET);
	input.menu.style.removeProperty("max-height");
	const room = input.viewportHeight - input.menu.getBoundingClientRect().top - GAP_BELOW_MENU;
	if (room >= MIN_MENU_HEIGHT) input.menu.style.maxHeight = `${room}px`;
	else input.menu.classList.add(SHEET);
}

export function initReadlistPicker(deps: ReadlistPickerDeps): { attach(): void } {
	function pickers(): NodeListOf<Element> {
		return deps.document.querySelectorAll(PICKER);
	}

	function attach(): void {
		deps.document.addEventListener("click", (event) => {
			const clickedThrough = event.composedPath();
			for (const picker of pickers()) {
				if (!clickedThrough.includes(picker)) picker.removeAttribute("open");
			}
		});

		deps.document.addEventListener("keydown", (event) => {
			if (event.key !== "Escape") return;
			for (const picker of pickers()) {
				if (!picker.hasAttribute("open")) continue;
				const heldFocus = picker.contains(deps.document.activeElement);
				picker.removeAttribute("open");
				const trigger = picker.querySelector<HTMLElement>(TRIGGER);
				if (heldFocus && trigger !== null) trigger.focus();
			}
		});

		deps.document.addEventListener(
			"toggle",
			(event) => {
				const toggledId: unknown = Reflect.get(Object(event.target), "id");
				for (const picker of pickers()) {
					if (picker.querySelector(`[popovertarget="${toggledId}"]`) === null) continue;
					if (event.newState === "open") {
						picker.removeAttribute("open");
						return;
					}
					const dialog = `[id="${toggledId}"]`;
					const focusStranded =
						deps.document.activeElement === deps.document.body ||
						deps.document.querySelector(`${dialog}:focus, ${dialog} :focus`) !== null;
					if (!focusStranded) return;
					const trigger = picker.querySelector<HTMLElement>(TRIGGER);
					if (trigger !== null) trigger.focus({ preventScroll: true });
					return;
				}
			},
			true,
		);

		deps.document.addEventListener(
			"toggle",
			(event) => {
				for (const picker of pickers()) {
					if (picker !== event.target || !picker.hasAttribute("open")) continue;
					for (const menu of picker.querySelectorAll<HTMLElement>(MENU)) {
						fitMenu({ menu, viewportHeight: deps.document.documentElement.clientHeight });
					}
					picker.querySelector<HTMLElement>(OPTION)?.focus();
				}
			},
			true,
		);
	}

	return { attach };
}
