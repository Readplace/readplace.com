export interface GmailPickerDeps {
	document: Document;
}

export function initGmailPicker({ document }: GmailPickerDeps): void {
	if (document.documentElement.hasAttribute("data-gmail-picker-attached")) return;
	document.documentElement.setAttribute("data-gmail-picker-attached", "");
	const pickers = () => document.querySelectorAll<HTMLDetailsElement>("[data-gmail-picker]");
	document.addEventListener("click", (event) => {
		const path = event.composedPath();
		for (const picker of pickers()) {
			if (!path.includes(picker)) picker.open = false;
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		for (const picker of pickers()) {
			if (!picker.open) continue;
			const heldFocus = picker.contains(document.activeElement);
			picker.open = false;
			if (heldFocus) picker.querySelector<HTMLElement>("[data-gmail-picker-trigger]")?.focus();
		}
	});
	document.addEventListener("toggle", (event) => {
		for (const picker of pickers()) {
			if (picker !== event.target || !picker.open) continue;
			picker.querySelector<HTMLElement>("[data-gmail-picker-focus]")?.focus();
		}
	}, true);
}
