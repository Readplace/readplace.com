/**
 * Auto-dismisses any `[data-dismiss]` element after the millisecond delay it
 * declares, and keeps keyboard focus with the element the reader acted on when
 * an htmx swap would otherwise drop it to `<body>`. Lives globally (loaded on
 * every page) and rescans on htmx swaps, because a toast usually arrives inside
 * a swapped `<main>` — a page-level script that ran once on the initial load
 * never sees it. Dependencies are injected so the browser wiring stays out of
 * this module and it stays unit-testable.
 */
export interface ToastDismissDeps {
	document: Document;
	setTimeoutFn: (callback: () => void, ms: number) => void;
	addSwapListener: (listener: () => void) => void;
	/** Fires on `htmx:beforeRequest` — the last moment the pressed button is still
	 * the active element, before `hx-disabled-elt` disables and thereby blurs it. */
	addBeforeRequestListener: (listener: () => void) => void;
	/** Fires on `htmx:afterSettle`, once the swapped-in markup (carrying the
	 * restore target's stable id) is live in the DOM. */
	addAfterSettleListener: (listener: () => void) => void;
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
	// Id of the element focused when the reader fired an htmx action, captured on
	// beforeRequest before `hx-disabled-elt` blurs the pressed button. Empty means
	// nothing to restore. Every request overwrites it, so it never goes stale.
	let pendingFocusId = "";

	function announce(toast: Element): void {
		if (!region) return;
		const messageEl = toast.querySelector(".toast__message");
		assert(messageEl, "a toast must carry a .toast__message to announce");
		const message = messageEl.textContent;
		deps.setTimeoutFn(() => {
			region.textContent = message;
		}, LIVE_REGION_SETTLE_MS);
	}

	function isFocusOnBody(): boolean {
		const active = deps.document.activeElement;
		if (active === deps.document.body) return true;
		return active === deps.document.documentElement;
	}

	function newestToast(): HTMLElement | null {
		const toasts = deps.document.querySelectorAll<HTMLElement>("[data-dismiss]");
		if (toasts.length === 0) return null;
		return toasts[toasts.length - 1];
	}

	function dismiss(toast: Element): void {
		// Focus only lands inside a toast via the restore fallback below; removing
		// the toast would then drop it to `<body>` a second time. Hand focus back to
		// the recorded element if it still exists, else removal falls to `<body>` —
		// rare and terminal, no worse than before this script existed.
		if (toast.contains(deps.document.activeElement)) {
			const target = deps.document.getElementById(pendingFocusId);
			if (target !== null) target.focus();
		}
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

	function captureFocus(): void {
		const active = deps.document.activeElement;
		pendingFocusId = active === null ? "" : active.id;
	}

	function restoreFocus(): void {
		// Nothing recorded — the request came from an element with no id, so there is
		// no stable target to return to.
		if (pendingFocusId === "") return;
		// Reclaim focus only when the swap dropped it to `<body>`; never yank focus
		// the reader deliberately moved elsewhere while the request was in flight.
		if (!isFocusOnBody()) return;
		const target = deps.document.getElementById(pendingFocusId);
		if (target !== null) {
			target.focus();
			return;
		}
		// The acted-on element didn't survive the swap (a future flow that removes
		// it); the toast is the only announcement of the result, so land focus there.
		const fallback = newestToast();
		if (fallback !== null) fallback.focus();
	}

	dismissPending();
	deps.addSwapListener(dismissPending);
	deps.addBeforeRequestListener(captureFocus);
	deps.addAfterSettleListener(restoreFocus);
}
