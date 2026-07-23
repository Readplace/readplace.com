/**
 * Auto-dismisses any `[data-dismiss]` element after the millisecond delay it
 * declares. Lives globally (loaded on every page) and rescans on htmx swaps,
 * because a toast usually arrives inside a swapped `<main>` — a page-level
 * script that ran once on the initial load never sees it. Dependencies are
 * injected so the browser wiring stays out of this module and it stays
 * unit-testable.
 */
export interface ToastDismissDeps {
	document: Document;
	setTimeoutFn: (callback: () => void, ms: number) => void;
	addSwapListener: (listener: () => void) => void;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/** Matches the CSS fade-out transition duration: the toast
 * fades for this long before it is removed from the DOM. */
const FADE_OUT_MS = 300;

const LIVE_REGION_SETTLE_MS = 150;

export function initToastDismiss(deps: ToastDismissDeps): void {
	const scheduled = new WeakSet<Element>();
	const region = deps.document.getElementById("toast-live-region");

	function announce(toast: Element): void {
		if (!region) return;
		const messageEl = toast.querySelector(".toast__message");
		assert(messageEl, "a toast must carry a .toast__message to announce");
		const message = messageEl.textContent;
		deps.setTimeoutFn(() => {
			region.textContent = message;
		}, LIVE_REGION_SETTLE_MS);
	}

	function dismiss(toast: Element): void {
		toast.classList.add("toast--dismissing");
		if (region) region.textContent = "";
		deps.setTimeoutFn(() => toast.remove(), FADE_OUT_MS);
	}

	function scheduleToast(toast: Element): void {
		if (scheduled.has(toast)) return;
		const ms = Number(toast.getAttribute("data-dismiss"));
		if (!Number.isFinite(ms)) return;
		if (ms <= 0) return;
		scheduled.add(toast);
		deps.setTimeoutFn(() => dismiss(toast), ms);
		announce(toast);
	}

	function dismissPending(): void {
		const toasts = deps.document.querySelectorAll("[data-dismiss]");
		for (let i = 0; i < toasts.length; i++) {
			scheduleToast(toasts[i]);
		}
	}

	dismissPending();
	deps.addSwapListener(dismissPending);
}
