/**
 * Auto-dismisses any `[data-dismiss]` element after the millisecond delay it
 * declares. Lives globally (loaded on every page) and rescans on htmx swaps,
 * because a toast usually arrives inside a swapped `<main>` — a page-level
 * script that ran once on the initial load never sees it. Dependencies are
 * injected so the browser wiring lives in build-client-bundles.js and the
 * module stays unit-testable.
 */
export interface ToastDismissDeps {
	document: Document;
	setTimeoutFn: (callback: () => void, ms: number) => void;
	addSwapListener: (listener: () => void) => void;
}

export function initToastDismiss(deps: ToastDismissDeps): void {
	const scheduled = new WeakSet<Element>();

	function scheduleToast(toast: Element): void {
		if (scheduled.has(toast)) return;
		const ms = Number(toast.getAttribute("data-dismiss"));
		if (!Number.isFinite(ms)) return;
		if (ms <= 0) return;
		scheduled.add(toast);
		deps.setTimeoutFn(() => toast.remove(), ms);
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
