export function scrollUnderHeader(selector: string): void {
	const target = document.querySelector(selector);
	const header = document.querySelector("header.header");
	if (!target || !header) throw new Error(`scrollUnderHeader needs both ${selector} and the site header`);
	const top = window.scrollY + target.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 8;
	window.scrollTo({ top, behavior: "instant" });
}

export function maxScrollY(): number {
	return document.documentElement.scrollHeight - window.innerHeight;
}

export function recordScrollAfterSwap(selector: string): void {
	const control = document.querySelector(selector);
	if (!control) throw new Error(`recordScrollAfterSwap needs ${selector}`);
	function record(event: Event): void {
		if (!(event instanceof CustomEvent)) return;
		const trigger: unknown = event.detail?.requestConfig?.elt;
		if (!(trigger instanceof Element) || !(trigger === control || trigger.contains(control))) return;
		document.removeEventListener("htmx:afterSettle", record);
		let last = window.scrollY;
		let stableFrames = 0;
		function stampOnceStill(): void {
			if (window.scrollY === last) {
				stableFrames += 1;
			} else {
				stableFrames = 0;
				last = window.scrollY;
			}
			if (stableFrames < 10) {
				requestAnimationFrame(stampOnceStill);
				return;
			}
			document.documentElement.setAttribute("data-test-scroll-after-swap", String(window.scrollY));
		}
		requestAnimationFrame(stampOnceStill);
	}
	document.addEventListener("htmx:afterSettle", record);
}
