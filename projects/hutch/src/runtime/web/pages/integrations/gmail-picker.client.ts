export interface GmailPickerDeps {
	document: Document;
}

const PICKER_ITEMS = "[data-gmail-picker-focus], [data-gmail-picker-option]";

const FOCUSED_PICKER_ITEM = "[data-gmail-picker-focus]:focus, [data-gmail-picker-option]:focus";

const ARROW_STEPS: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

export function initGmailPicker({ document }: GmailPickerDeps): void {
	if (document.documentElement.hasAttribute("data-gmail-picker-attached")) return;
	document.documentElement.setAttribute("data-gmail-picker-attached", "");
	const pickers = () => document.querySelectorAll<HTMLDetailsElement>("[data-gmail-picker]");
	const dismissHighlights = () => {
		for (const choice of document.querySelectorAll<HTMLElement>("[data-gmail-notification-highlight]")) {
			document.documentElement.setAttribute("data-gmail-notification-dismissed", choice.getAttribute("data-gmail-notification") ?? "");
			choice.removeAttribute("data-gmail-notification-highlight");
		}
	};
	document.addEventListener("pointerdown", dismissHighlights, true);
	document.addEventListener("click", dismissHighlights, true);
	document.addEventListener("htmx:afterSettle", () => {
		const dismissed = document.documentElement.getAttribute("data-gmail-notification-dismissed");
		for (const choice of document.querySelectorAll<HTMLElement>("[data-gmail-notification-highlight]")) {
			if (choice.getAttribute("data-gmail-notification") === dismissed) choice.removeAttribute("data-gmail-notification-highlight");
		}
	});
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
	document.addEventListener("keydown", (event) => {
		const step = ARROW_STEPS[event.key];
		if (step === undefined) return;
		for (const picker of pickers()) {
			if (!picker.open || !picker.contains(document.activeElement)) continue;
			const items = [...picker.querySelectorAll<HTMLElement>(PICKER_ITEMS)].filter((item) => !item.hasAttribute("disabled"));
			const focusedItem = picker.querySelector<HTMLElement>(FOCUSED_PICKER_ITEM);
			const current = focusedItem === null ? -1 : items.indexOf(focusedItem);
			event.preventDefault();
			items[Math.min(Math.max(current + step, 0), items.length - 1)]?.focus();
		}
	});
	document.addEventListener("change", (event) => {
		const target = [...document.querySelectorAll<HTMLInputElement>("[data-gmail-readlist-checkbox]")].find((checkbox) => checkbox === event.target);
		if (target === undefined || target.disabled) return;
		const form = target.closest<HTMLFormElement>("[data-gmail-readlist-selection]");
		const confirm = form?.querySelector<HTMLButtonElement>("[data-gmail-confirm-readlists]");
		confirm?.click();
	});
	document.addEventListener("change", (event) => {
		const target = [...document.querySelectorAll<HTMLInputElement>("[data-gmail-delivery-option]")].find((radio) => radio === event.target);
		target?.closest<HTMLFormElement>("[data-gmail-readlist-selection]")?.requestSubmit();
	});
	document.addEventListener("toggle", (event) => {
		for (const picker of pickers()) {
			if (picker !== event.target || !picker.open) continue;
			picker.querySelector<HTMLElement>("[data-gmail-picker-focus]")?.focus();
		}
	}, true);
}
