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

/** Reader views give the article the whole viewport: the global nav slides up
 * out of view on scroll-down and returns on scroll-up (or at the top). The
 * sticky mark-as-read toolbar rises with it to stay pinned at the top — the
 * `.nav-hidden` rules in base.styles.ts / reader.styles.css do the movement;
 * this only toggles the class on `<html>`.
 *
 * Loaded globally (via siteScripts), not through the reader's PageBody.scripts:
 * readers are reached by hx-boost, which swaps only <main> and never runs a
 * page's body scripts, and the nav lives outside <main>. So the one window
 * scroll listener is attached on every Base page and self-gates on the reader
 * body marker — inert everywhere else. */
export function initReaderNav(deps: ReaderNavDeps): void {
	const header = deps.document.querySelector<HTMLElement>(".header");
	if (header === null) return;
	const root = deps.document.documentElement;

	const isReader = (): boolean =>
		deps.document.querySelector("[data-article-body]") !== null;

	let currentMain = deps.document.querySelector("main");
	let active = isReader();
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
		if (active) {
			if (y <= headerHeight) show();
			else if (y > lastY + DELTA_PX) hide();
			else if (y < lastY - DELTA_PX) show();
		}
		lastY = y;
	};

	/** A genuine navigation replaces <main>; the ~3s progress-bar hx-swap-oob
	 * poll swaps an inner node and leaves <main> intact. Re-arm only on a real
	 * <main> swap, so a poll never springs the hidden nav back open mid-read. */
	const onSwap = (): void => {
		const main = deps.document.querySelector("main");
		if (main === currentMain) return;
		currentMain = main;
		active = isReader();
		lastY = deps.window.scrollY;
		headerHeight = header.offsetHeight;
		show();
	};

	deps.window.addEventListener("scroll", onScroll, { passive: true });
	deps.addSwapListener(onSwap);
}
