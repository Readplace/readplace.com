interface ShareBalloonWindow {
	readonly scrollY: number;
	addEventListener(
		type: "scroll",
		listener: () => void,
		options: { passive: true },
	): void;
	removeEventListener(type: "scroll", listener: () => void): void;
}

interface ShareBalloonStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

interface ShareBalloonNavigator {
	share?: (data: { title: string; url: string }) => Promise<void>;
	clipboard?: { writeText(text: string): Promise<void> };
}

type ShareTimerId = ReturnType<typeof setTimeout>;

interface ShareBalloonDeps {
	window: ShareBalloonWindow;
	document: Document;
	storage: ShareBalloonStorage;
	navigator: ShareBalloonNavigator;
	setTimeoutFn: (cb: () => void, ms: number) => ShareTimerId;
	clearTimeoutFn: (id: ShareTimerId) => void;
}

interface ShareBalloonController {
	attach(): void;
	detach(): void;
}

export function initShareBalloon(
	deps: ShareBalloonDeps,
): ShareBalloonController {
	const STORAGE_KEY = "readplace.share-dismissed";
	const SCROLL_THRESHOLD_PX = 100;
	const OPEN_DELAY_MS = 1000;
	const COPIED_FADE_MS = 3000;
	const OPEN_CLASS = "share-balloon__wrap--open";
	const COPIED_VISIBLE_CLASS = "share-balloon__copied--visible";

	function ensure<T>(value: T | null | undefined, description: string): T {
		if (value === null || value === undefined) {
			throw new Error(`share balloon: ${description}`);
		}
		return value;
	}

	function pickElement(root: Document | HTMLElement, selector: string): HTMLElement {
		return ensure(root.querySelector<HTMLElement>(selector), `missing element ${selector}`);
	}

	function pickAttribute(el: HTMLElement, attr: string): string {
		return ensure(el.getAttribute(attr), `missing attribute ${attr}`);
	}

	function readDismissed(): boolean {
		try {
			return deps.storage.getItem(STORAGE_KEY) === "1";
		} catch {
			return false;
		}
	}

	function writeDismissed(): void {
		try {
			deps.storage.setItem(STORAGE_KEY, "1");
		} catch {
			/* storage may throw in private mode — swallow */
		}
	}

	const wrap = pickElement(deps.document, "[data-share-balloon-wrap]");
	const btn = pickElement(wrap, "[data-share-balloon]");
	const closeBtn = pickElement(wrap, "[data-share-balloon-close]");
	const copiedLabel = pickElement(wrap, "[data-share-balloon-copied]");
	const status = pickElement(deps.document, "[data-share-balloon-status]");

	const url = pickAttribute(btn, "data-share-url");
	const title = pickAttribute(btn, "data-share-title");

	const canShare = typeof deps.navigator.share === "function";
	const canCopy = deps.navigator.clipboard !== undefined;

	let openTimerId: ShareTimerId | null = null;
	let fadeTimerId: ShareTimerId | null = null;
	let scrollListener: (() => void) | null = null;
	let closeListener: ((event: Event) => void) | null = null;
	let clickListener: (() => void) | null = null;
	let attached = false;

	function openBalloon() {
		openTimerId = null;
		wrap.classList.add(OPEN_CLASS);
	}

	function cancelPendingOpen() {
		if (openTimerId !== null) {
			deps.clearTimeoutFn(openTimerId);
			openTimerId = null;
		}
	}

	function cancelPendingFade() {
		if (fadeTimerId !== null) {
			deps.clearTimeoutFn(fadeTimerId);
			fadeTimerId = null;
		}
	}

	function onScroll() {
		if (deps.window.scrollY < SCROLL_THRESHOLD_PX) return;
		if (scrollListener !== null) {
			deps.window.removeEventListener("scroll", scrollListener);
			scrollListener = null;
		}
		openTimerId = deps.setTimeoutFn(openBalloon, OPEN_DELAY_MS);
	}

	function flashCopied() {
		copiedLabel.classList.add(COPIED_VISIBLE_CLASS);
		status.textContent = "Link copied to clipboard";
		fadeTimerId = deps.setTimeoutFn(() => {
			fadeTimerId = null;
			copiedLabel.classList.remove(COPIED_VISIBLE_CLASS);
			status.textContent = "";
		}, COPIED_FADE_MS);
	}

	function onShareClick() {
		if (deps.navigator.clipboard !== undefined) {
			deps.navigator.clipboard.writeText(url).then(flashCopied, () => {
				status.textContent = "Unable to copy link";
			});
		}
		if (deps.navigator.share !== undefined) {
			deps.navigator.share({ title, url }).catch((err) => {
				if (err && err.name === "AbortError") return;
			});
		}
	}

	function onCloseClick(event: Event) {
		event.stopPropagation();
		cancelPendingOpen();
		if (scrollListener !== null) {
			deps.window.removeEventListener("scroll", scrollListener);
			scrollListener = null;
		}
		wrap.classList.remove(OPEN_CLASS);
		writeDismissed();
	}

	function attach(): void {
		if (attached) return;
		if (!canShare && !canCopy) return;
		attached = true;
		wrap.hidden = false;

		if (!readDismissed()) {
			scrollListener = onScroll;
			deps.window.addEventListener("scroll", scrollListener, { passive: true });
			onScroll();
		}

		closeListener = onCloseClick;
		closeBtn.addEventListener("click", closeListener);
		clickListener = onShareClick;
		btn.addEventListener("click", clickListener);
	}

	function detach(): void {
		if (!attached) return;
		attached = false;
		cancelPendingOpen();
		cancelPendingFade();
		if (scrollListener !== null) {
			deps.window.removeEventListener("scroll", scrollListener);
			scrollListener = null;
		}
		if (closeListener !== null) {
			closeBtn.removeEventListener("click", closeListener);
			closeListener = null;
		}
		if (clickListener !== null) {
			btn.removeEventListener("click", clickListener);
			clickListener = null;
		}
	}

	return { attach, detach };
}
