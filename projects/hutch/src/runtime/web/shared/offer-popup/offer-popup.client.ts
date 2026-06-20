import {
	type PopupState,
	isDismissed,
	parseStoredState,
	serializeState,
} from "./offer-popup.logic";

interface OfferPopupStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface OfferPopupDeps {
	document: Document;
	storage: OfferPopupStorage;
}

interface OfferPopupController {
	attach(): void;
}

const STORAGE_KEY = "readplace.offer-popup.v1";
const ROOT_SELECTOR = "[data-offer-popup]";
const OPEN_CLASS = "offer-popup--open";
const STAGE_ATTR = "data-offer-stage";
const FOCUSABLE_SELECTOR = "a[href], button:not([disabled])";

type Stage = "offer" | "confirm-first" | "confirm-second";

function ensure<T>(value: T | null, description: string): T {
	if (value === null) throw new Error(`offer-popup: ${description}`);
	return value;
}

export function initOfferPopup(deps: OfferPopupDeps): OfferPopupController {
	const root = ensure(
		deps.document.querySelector<HTMLElement>(ROOT_SELECTOR),
		`missing element ${ROOT_SELECTOR}`,
	);

	let currentStage: Stage = "offer";
	let restoreFocus: (() => void) | null = null;

	function currentView(): HTMLElement {
		return ensure(
			root.querySelector<HTMLElement>(`.offer-popup__view--${currentStage}`),
			`missing view for stage ${currentStage}`,
		);
	}

	function focusFirstControl(): void {
		ensure(
			currentView().querySelector<HTMLElement>(FOCUSABLE_SELECTOR),
			`stage ${currentStage} must expose a focusable control`,
		).focus();
	}

	function setStage(stage: Stage): void {
		currentStage = stage;
		root.setAttribute(STAGE_ATTR, stage);
		root.setAttribute("aria-labelledby", `offer-popup-title-${stage}`);
		focusFirstControl();
	}

	/** Takes the page out of the tab/AT tree while the dialog is open. Inerting
	 * the popup root's siblings covers the whole page because the popup renders
	 * as a direct child of <body>. */
	function setBackgroundInert(inert: boolean): void {
		const parent = ensure(root.parentElement, "popup root must have a parent");
		for (const sibling of Array.from(parent.children)) {
			if (sibling === root) continue;
			if (inert) {
				sibling.setAttribute("inert", "");
				sibling.setAttribute("aria-hidden", "true");
			} else {
				sibling.removeAttribute("inert");
				sibling.removeAttribute("aria-hidden");
			}
		}
	}

	/** Hands focus back to whatever held it before the dialog opened. The DOM
	 * types `activeElement` as `Element`, which omits `focus()`, so we read the
	 * method reflectively rather than reference the realm's `HTMLElement`
	 * constructor (absent under the Node test runtime). */
	function captureRestoreFocus(): () => void {
		const active = ensure(
			deps.document.activeElement,
			"document must expose an active element",
		);
		const focus = Reflect.get(active, "focus");
		return () => focus.call(active);
	}

	function trapFocus(event: KeyboardEvent): void {
		if (event.key !== "Tab") return;
		const controls = Array.from(
			currentView().querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
		);
		const first = controls[0];
		const last = controls[controls.length - 1];
		const active = deps.document.activeElement;
		if (event.shiftKey) {
			if (active === first) {
				last.focus();
				event.preventDefault();
			}
		} else if (active === last) {
			first.focus();
			event.preventDefault();
		}
	}

	function readState(): PopupState {
		try {
			return parseStoredState(deps.storage.getItem(STORAGE_KEY));
		} catch {
			return {};
		}
	}

	function persist(state: PopupState): void {
		try {
			deps.storage.setItem(STORAGE_KEY, serializeState(state));
		} catch {
			/* storage may throw in private mode — swallow */
		}
	}

	function dismiss(): void {
		const state = readState();
		state.closed = true;
		persist(state);
		root.classList.remove(OPEN_CLASS);
		root.removeEventListener("keydown", trapFocus);
		setBackgroundInert(false);
		const restore = ensure(restoreFocus, "popup must be open before dismiss");
		restore();
	}

	function bind(selector: string, handler: () => void): void {
		root.querySelectorAll(selector).forEach((el) => {
			el.addEventListener("click", handler);
		});
	}

	function open(): void {
		restoreFocus = captureRestoreFocus();
		root.classList.add(OPEN_CLASS);
		root.addEventListener("keydown", trapFocus);
		setBackgroundInert(true);
		setStage("offer");
	}

	function attach(): void {
		bind('[data-offer-action="close"]', () => setStage("confirm-first"));
		bind('[data-offer-action="confirm"]', () => setStage("confirm-second"));
		bind('[data-offer-action="keep"]', () => setStage("offer"));
		bind('[data-offer-action="dismiss"]', dismiss);

		if (isDismissed(readState())) return;
		open();
	}

	return { attach };
}
