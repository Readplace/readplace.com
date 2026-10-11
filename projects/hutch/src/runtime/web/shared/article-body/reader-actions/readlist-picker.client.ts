export interface ReadlistPickerDeps {
	document: Document;
}

const PICKER = ".article-body__readlists";
const TRIGGER = ".article-body__readlists-trigger";

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
	}

	return { attach };
}
