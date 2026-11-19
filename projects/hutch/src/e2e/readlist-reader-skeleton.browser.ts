export function htmxIsLive(): boolean {
	const [navigation] = performance.getEntriesByType("navigation");
	return (
		"htmx" in window &&
		navigation instanceof PerformanceNavigationTiming &&
		navigation.domContentLoadedEventEnd > 0
	);
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
