import {
	OFFER_WINDOW_MS,
	type PopupState,
	formatCountdown,
	isDismissed,
	parseStoredState,
	serializeState,
} from "./offer-popup.logic";

interface OfferPopupStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface OfferPopupLocation {
	search: string;
}

interface OfferPopupDeps {
	document: Document;
	storage: OfferPopupStorage;
	location: OfferPopupLocation;
	now: () => number;
	setIntervalFn: (cb: () => void, ms: number) => number;
	clearIntervalFn: (id: number) => void;
}

interface OfferPopupController {
	attach(): void;
}

const STORAGE_KEY = "readplace.offer-popup.v1";
const ROOT_SELECTOR = "[data-offer-popup]";
const COUNTDOWN_SELECTOR = "[data-offer-countdown]";
const OPEN_CLASS = "offer-popup--open";
const STAGE_ATTR = "data-offer-stage";
const PREVIEW_PARAM = "offer-preview";
const COUNTDOWN_TICK_MS = 1000;
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
	const preview =
		new URLSearchParams(deps.location.search).get(PREVIEW_PARAM) === "1";

	let dismissed = false;
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
		focusFirstControl();
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

	function paintCountdown(deadlineMs: number): number {
		const remaining = deadlineMs - deps.now();
		const text = formatCountdown(remaining);
		root.querySelectorAll(COUNTDOWN_SELECTOR).forEach((el) => {
			el.textContent = text;
		});
		return remaining;
	}

	function startCountdown(deadlineMs: number): void {
		paintCountdown(deadlineMs);
		const id = deps.setIntervalFn(() => {
			if (dismissed) {
				deps.clearIntervalFn(id);
				return;
			}
			if (paintCountdown(deadlineMs) <= 0) {
				deps.clearIntervalFn(id);
			}
		}, COUNTDOWN_TICK_MS);
	}

	function dismiss(): void {
		dismissed = true;
		if (!preview) {
			const state = readState();
			state.closed = true;
			persist(state);
		}
		root.classList.remove(OPEN_CLASS);
		root.removeEventListener("keydown", trapFocus);
		const restore = ensure(restoreFocus, "popup must be open before dismiss");
		restore();
	}

	function bind(selector: string, handler: () => void): void {
		root.querySelectorAll(selector).forEach((el) => {
			el.addEventListener("click", handler);
		});
	}

	function open(deadlineMs: number): void {
		restoreFocus = captureRestoreFocus();
		root.classList.add(OPEN_CLASS);
		root.addEventListener("keydown", trapFocus);
		setStage("offer");
		startCountdown(deadlineMs);
	}

	function attach(): void {
		bind('[data-offer-action="close"]', () => setStage("confirm-first"));
		bind('[data-offer-action="confirm"]', () => setStage("confirm-second"));
		bind('[data-offer-action="keep"]', () => setStage("offer"));
		bind('[data-offer-action="dismiss"]', dismiss);

		const now = deps.now();
		if (preview) {
			open(now + OFFER_WINDOW_MS);
			return;
		}

		if (isDismissed(readState())) return;
		open(now + OFFER_WINDOW_MS);
	}

	return { attach };
}
