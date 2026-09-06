export function htmxIsLive(): boolean {
	return "htmx" in window;
}

export function readScrollY(): number {
	return window.scrollY;
}
