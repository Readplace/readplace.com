export function htmxIsLive(): boolean {
	return "htmx" in window;
}

export function readScrollY(): number {
	return window.scrollY;
}

export function recordScrollAfterMainSwap(): void {
	function record(event: Event): void {
		if (!(event.target instanceof Element) || !event.target.matches("main")) return;
		document.removeEventListener("htmx:afterSettle", record);
		queueMicrotask(() => {
			document.documentElement.setAttribute("data-test-scroll-after-main-swap", String(window.scrollY));
		});
	}
	document.addEventListener("htmx:afterSettle", record);
}
