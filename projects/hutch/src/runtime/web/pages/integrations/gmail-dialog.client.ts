export interface GmailDialogDeps {
	document: Document;
	supportsPopover: () => boolean;
	isOpen: (panel: Element) => boolean;
	showPopover: (panel: Element) => void;
	follow: (anchor: HTMLAnchorElement) => void;
}

const DIALOG_ID = "gmail-dialog";
const ATTACHED_FLAG = "data-gmail-dialog-attached";
const OPENER_ATTR = "data-gmail-dialog-opener";
const OPENER_CONTROL_ATTR = "data-gmail-opener";
const CANCEL_SELECTOR = "[data-gmail-dialog-cancel]";
const SAVE_SELECTOR = "[data-gmail-dialog-save]";
const OPEN_PICKER_SELECTOR = "[data-gmail-picker][open]";
const BACKGROUND_SELECTOR = "[data-background-request]";
const DISMISSED_ATTR = "data-gmail-dialog-dismissed";
const PAGE_SWAP = "outerHTML show:none";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(node: unknown): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

function detailOf(event: Event): object {
	return Object(Reflect.get(event, "detail"));
}

export function initGmailDialog(deps: GmailDialogDeps): void {
	const { document } = deps;
	if (document.documentElement.hasAttribute(ATTACHED_FLAG)) return;
	document.documentElement.setAttribute(ATTACHED_FLAG, "");
	const inFlight = new Set<unknown>();
	let opener: string | undefined;

	const dialog = () => document.getElementById(DIALOG_ID);
	const insideDialog = (node: unknown): node is Element => {
		const panel = dialog();
		return panel !== null && isElement(node) && panel.contains(node);
	};
	const answerHolds = (input: { responseText: unknown; id: string }): boolean => {
		const parsed = document.createElement("template");
		parsed.innerHTML = String(input.responseText);
		return parsed.content.getElementById(input.id) !== null;
	};

	const show = () => {
		const panel = dialog();
		if (panel === null || !deps.supportsPopover() || panel.hasAttribute(DISMISSED_ATTR)) return;
		if (!deps.isOpen(panel)) {
			deps.showPopover(panel);
			return;
		}
		if (panel.contains(document.activeElement)) return;
		const save = panel.querySelector<HTMLElement>(SAVE_SELECTOR);
		assert(save, "the Gmail popup always renders its Save");
		save.focus();
	};

	const returnFocus = () => {
		const token = opener;
		opener = undefined;
		if (token === undefined || dialog() !== null) return;
		const control = [...document.querySelectorAll<HTMLElement>(`[${OPENER_CONTROL_ATTR}]`)].find((element) => element.getAttribute(OPENER_CONTROL_ATTR) === token);
		control?.focus({ preventScroll: true });
	};

	document.addEventListener("htmx:beforeRequest", (event) => {
		const elt = Reflect.get(detailOf(event), "elt");
		if (!insideDialog(elt) || elt.closest(BACKGROUND_SELECTOR) !== null) return;
		inFlight.add(Reflect.get(detailOf(event), "xhr"));
		const token = dialog()?.getAttribute(OPENER_ATTR);
		assert(typeof token === "string", "the Gmail popup always names the control that opened it");
		opener = token;
	});

	document.addEventListener("htmx:afterRequest", (event) => {
		inFlight.delete(Reflect.get(detailOf(event), "xhr"));
	});

	document.addEventListener("htmx:beforeSwap", (event) => {
		const detail = detailOf(event);
		const target = Reflect.get(detail, "target");
		if (!insideDialog(target) || target.id === "") return;
		if (answerHolds({ responseText: Reflect.get(Object(Reflect.get(detail, "xhr")), "responseText"), id: target.id })) return;
		const main = document.querySelector("main");
		assert(main, "the Gmail page always renders a <main>");
		Reflect.set(detail, "target", main);
		Reflect.set(detail, "selectOverride", "main");
		Reflect.set(detail, "swapOverride", PAGE_SWAP);
	});

	document.addEventListener("htmx:afterSettle", (event) => {
		const elt = Reflect.get(detailOf(event), "elt");
		if (isElement(elt) && elt.closest(BACKGROUND_SELECTOR) !== null) return;
		returnFocus();
		show();
	});

	document.addEventListener("htmx:historyRestore", show);

	document.addEventListener("toggle", (event) => {
		const panel = dialog();
		if (panel === null || event.target !== panel || Reflect.get(event, "newState") !== "closed") return;
		if (inFlight.size > 0) {
			deps.showPopover(panel);
			return;
		}
		const cancel = panel.querySelector<HTMLAnchorElement>(CANCEL_SELECTOR);
		assert(cancel, "the Gmail popup always renders its Cancel link");
		panel.setAttribute(DISMISSED_ATTR, "");
		deps.follow(cancel);
	}, true);

	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") return;
		const panel = dialog();
		if (panel === null || !deps.supportsPopover() || !deps.isOpen(panel)) return;
		if (panel.querySelector(OPEN_PICKER_SELECTOR) !== null) event.preventDefault();
	}, true);

	show();
}
