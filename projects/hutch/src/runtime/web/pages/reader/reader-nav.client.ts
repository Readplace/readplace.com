interface ReaderNavWindow {
	readonly scrollY: number;
	addEventListener(
		type: "scroll",
		listener: () => void,
		options: { passive: true },
	): void;
}

interface ReaderNavDeps {
	document: Document;
	window: ReaderNavWindow;
	addSwapListener: (listener: () => void) => void;
}

const HIDDEN_CLASS = "nav-hidden";
const DELTA_PX = 6;

/** Slides the global nav up out of view on scroll-down and back on scroll-up (or
 * at the top), so the reader — or the queue's saved cards — gets the whole
 * viewport. The `.nav-hidden` rules in base.styles.ts / reader.styles.css do the
 * movement; this only toggles the class on `<html>`. Only the nav moves: the
 * fixed banner-area stays put, so the changelog and other banners remain visible.
 *
 * Injected per page by the readers and the queue, not loaded globally — a page
 * that omits it keeps a static nav, so there is no gate here. It
 * stays armed across the in-place hx-boost swaps those pages make (save, filter,
 * mark-read): those swap <main> but keep the same document, so the one scroll
 * listener persists; onSwap re-arms on a real <main> swap and ignores the reader's
 * ~3s progress poll (which leaves <main> intact). */
export function initReaderNav(deps: ReaderNavDeps): void {
	const header = deps.document.querySelector<HTMLElement>(".header");
	if (header === null) return;
	const root = deps.document.documentElement;

	let currentMain = deps.document.querySelector("main");
	let lastY = deps.window.scrollY;
	let headerHeight = header.offsetHeight;

	const show = (): void => {
		root.classList.remove(HIDDEN_CLASS);
	};
	const hide = (): void => {
		root.classList.add(HIDDEN_CLASS);
	};

	const onScroll = (): void => {
		const y = deps.window.scrollY;
		if (y <= headerHeight) show();
		else if (y > lastY + DELTA_PX) hide();
		else if (y < lastY - DELTA_PX) show();
		lastY = y;
	};

	/** A genuine navigation replaces <main>; the ~3s progress-bar hx-swap-oob
	 * poll swaps an inner node and leaves <main> intact. Re-arm only on a real
	 * <main> swap, so a poll never springs the hidden nav back open mid-read. */
	const onSwap = (): void => {
		const main = deps.document.querySelector("main");
		if (main === currentMain) return;
		currentMain = main;
		lastY = deps.window.scrollY;
		headerHeight = header.offsetHeight;
		show();
	};

	deps.window.addEventListener("scroll", onScroll, { passive: true });
	deps.addSwapListener(onSwap);
}
