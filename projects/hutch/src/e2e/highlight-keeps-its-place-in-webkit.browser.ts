export function watchLowestScroll(): void {
	const stamp = "data-test-lowest-scroll";
	document.documentElement.setAttribute(stamp, String(window.scrollY));
	function note(): void {
		const lowest = Number(document.documentElement.getAttribute(stamp));
		if (window.scrollY < lowest) document.documentElement.setAttribute(stamp, String(window.scrollY));
	}
	window.addEventListener("scroll", note, { passive: true });
	function everyFrame(): void {
		note();
		requestAnimationFrame(everyFrame);
	}
	requestAnimationFrame(everyFrame);
}
