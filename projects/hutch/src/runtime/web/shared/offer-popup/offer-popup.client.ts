import {
	OFFER_WINDOW_MS,
	type PopupState,
	decideVisibility,
	formatCountdown,
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

	function setStage(stage: Stage): void {
		root.setAttribute(STAGE_ATTR, stage);
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
	}

	function bind(selector: string, handler: () => void): void {
		root.querySelectorAll(selector).forEach((el) => {
			el.addEventListener("click", handler);
		});
	}

	function open(deadlineMs: number): void {
		setStage("offer");
		root.classList.add(OPEN_CLASS);
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

		const decision = decideVisibility({ state: readState(), now });
		persist(decision.next);
		if (!decision.show) return;
		open(now + OFFER_WINDOW_MS);
	}

	return { attach };
}
