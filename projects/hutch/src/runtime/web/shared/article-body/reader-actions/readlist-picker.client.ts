export interface ReadlistPickerDeps {
	document: Document;
}

const PICKER = ".article-body__readlists";
const TRIGGER = ".article-body__readlists-trigger";
const ASSIGN_OPTION = ".article-body__readlists-option";
const CREATE_INPUT = ".article-body__readlists-create-input";

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
				for (const picker of pickers()) {
					if (picker !== event.target) continue;
					if (!picker.hasAttribute("open")) return;
					if (picker.querySelector(ASSIGN_OPTION) !== null) return;
					const create = picker.querySelector<HTMLInputElement>(CREATE_INPUT);
					if (create !== null) create.focus();
					return;
				}
			},
			true,
		);
	}

	return { attach };
}
