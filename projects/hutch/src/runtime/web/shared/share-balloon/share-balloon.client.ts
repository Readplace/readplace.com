import { PAYWALL_REVEALED_EVENT } from "../paywall-revealed-event";

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
	addSwapListener: (listener: () => void) => void;
	removeSwapListener: (listener: () => void) => void;
}

interface ShareBalloonController {
	attach(): void;
	detach(): void;
}

interface ShareBalloonPage {
	wrap: HTMLElement;
	shareBtn: HTMLElement;
	copyBtn: HTMLElement;
	closeBtn: HTMLElement;
	copiedLabel: HTMLElement;
	status: HTMLElement;
	articleEl: HTMLElement;
	shareUrl: string;
	copyUrl: string;
	title: string;
}

export function initShareBalloon(
	deps: ShareBalloonDeps,
): ShareBalloonController {
	const STORAGE_KEY = "readplace.share-dismissed";
	const OPEN_DELAY_MS = 1000;
	const COPIED_FADE_MS = 3000;
	const OPEN_CLASS = "share-balloon__wrap--open";
	const COPIED_VISIBLE_CLASS = "share-balloon__copied--visible";
	const OWNED_ATTR = "data-share-balloon-owned";

	function assert(cond: unknown, message: string): asserts cond {
		/** esbuild bundles this module for the browser, where `node:assert`
		 * is not resolvable, so the invariant check is inlined here. */
		if (!cond) throw new Error(`share balloon: ${message}`);
	}

	function ensure<T>(value: T | null | undefined, description: string): T {
		assert(value !== null && value !== undefined, description);
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

	function findWrap(): HTMLElement | null {
		return deps.document.querySelector<HTMLElement>("[data-share-balloon-wrap]");
	}

	function pageOf(wrap: HTMLElement): ShareBalloonPage {
		const shareBtn = pickElement(wrap, "[data-share-balloon]");
		const copyBtn = pickElement(wrap, "[data-share-balloon-copy]");
		return {
			wrap,
			shareBtn,
			copyBtn,
			closeBtn: pickElement(wrap, "[data-share-balloon-close]"),
			copiedLabel: pickElement(wrap, "[data-share-balloon-copied]"),
			status: pickElement(deps.document, "[data-share-balloon-status]"),
			articleEl: pickElement(deps.document, "[data-article-body]"),
			shareUrl: pickAttribute(shareBtn, "data-share-url"),
			copyUrl: pickAttribute(copyBtn, "data-share-url"),
			title: pickAttribute(shareBtn, "data-share-title"),
		};
	}

	const canShare = typeof deps.navigator.share === "function";
	const canCopy = deps.navigator.clipboard !== undefined;

	let page: ShareBalloonPage | null = null;
	let openTimerId: ShareTimerId | null = null;
	let fadeTimerId: ShareTimerId | null = null;
	let scrollListener: (() => void) | null = null;
	let paywallRevealListener: (() => void) | null = null;
	let attached = false;

	function isArticleReady(): boolean {
		const slot = deps.document.querySelector<HTMLElement>(
			"[data-reader-status]",
		);
		/** No reader-slot in the DOM means the host page does not track article
		 * crawl state (e.g. share-balloon-only test fixtures), so default to
		 * ready and let the balloon open in those contexts. */
		if (slot === null) return true;
		return slot.getAttribute("data-reader-status") === "ready";
	}

	function isPaywallActive(): boolean {
		return deps.document.querySelector('[data-paywall-active="true"]') !== null;
	}

	function openBalloon() {
		openTimerId = null;
		assert(page, "an open can only be scheduled while a balloon is adopted");
		if (isPaywallActive()) return;
		page.wrap.classList.add(OPEN_CLASS);
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

	function stopScrollWatch() {
		if (scrollListener !== null) {
			deps.window.removeEventListener("scroll", scrollListener);
			scrollListener = null;
		}
	}

	function stopPaywallWatch() {
		if (paywallRevealListener !== null) {
			deps.document.removeEventListener(
				PAYWALL_REVEALED_EVENT,
				paywallRevealListener,
			);
			paywallRevealListener = null;
		}
	}

	function onScroll() {
		assert(page, "a scroll can only be watched while a balloon is adopted");
		const threshold = page.articleEl.offsetHeight * 0.5;
		if (deps.window.scrollY < threshold) return;
		/** Keep the scroll listener attached while the article is still loading
		 * or errored — HTMX may transition the reader-slot to "ready" later,
		 * and we want the next scroll (or the swap listener below) to re-trigger
		 * this check rather than detaching prematurely. */
		if (!isArticleReady()) return;
		stopScrollWatch();
		openTimerId = deps.setTimeoutFn(openBalloon, OPEN_DELAY_MS);
	}

	function flashCopied(feedback: {
		copiedLabel: HTMLElement;
		status: HTMLElement;
	}) {
		const { copiedLabel, status } = feedback;
		copiedLabel.classList.add(COPIED_VISIBLE_CLASS);
		status.textContent = "Link copied to clipboard";
		fadeTimerId = deps.setTimeoutFn(() => {
			fadeTimerId = null;
			copiedLabel.classList.remove(COPIED_VISIBLE_CLASS);
			status.textContent = "";
		}, COPIED_FADE_MS);
	}

	function onShareClick() {
		assert(page, "the share button is only bound while a balloon is adopted");
		const { title, shareUrl } = page;
		if (deps.navigator.share !== undefined) {
			deps.navigator.share({ title, url: shareUrl }).catch((err) => {
				if (err && err.name === "AbortError") return;
			});
		}
	}

	function onCopyClick() {
		assert(page, "the copy button is only bound while a balloon is adopted");
		const { copyUrl, copiedLabel, status } = page;
		if (deps.navigator.clipboard !== undefined) {
			deps.navigator.clipboard.writeText(copyUrl).then(
				() => flashCopied({ copiedLabel, status }),
				() => {
					status.textContent = "Unable to copy link";
				},
			);
		}
	}

	function closeAndStopReopening() {
		assert(page, "a close can only be requested while a balloon is adopted");
		cancelPendingOpen();
		stopScrollWatch();
		stopPaywallWatch();
		page.wrap.classList.remove(OPEN_CLASS);
	}

	function onCloseClick(event: Event) {
		event.stopPropagation();
		closeAndStopReopening();
		writeDismissed();
	}

	function release(): void {
		cancelPendingOpen();
		cancelPendingFade();
		stopScrollWatch();
		stopPaywallWatch();
		const released = page;
		if (released === null) return;
		page = null;
		released.closeBtn.removeEventListener("click", onCloseClick);
		released.shareBtn.removeEventListener("click", onShareClick);
		released.copyBtn.removeEventListener("click", onCopyClick);
	}

	function adopt(wrap: HTMLElement): void {
		release();
		page = pageOf(wrap);
		page.wrap.hidden = false;
		page.shareBtn.hidden = !canShare;
		page.copyBtn.hidden = !canCopy;
		page.closeBtn.addEventListener("click", onCloseClick);
		page.shareBtn.addEventListener("click", onShareClick);
		page.copyBtn.addEventListener("click", onCopyClick);

		if (readDismissed()) return;
		scrollListener = onScroll;
		deps.window.addEventListener("scroll", scrollListener, { passive: true });
		paywallRevealListener = closeAndStopReopening;
		deps.document.addEventListener(
			PAYWALL_REVEALED_EVENT,
			paywallRevealListener,
		);
		onScroll();
	}

	function onSwap(): void {
		const wrap = findWrap();
		if (wrap === null) {
			release();
			return;
		}
		if (page !== null && wrap === page.wrap) {
			if (scrollListener !== null) onScroll();
			return;
		}
		adopt(wrap);
	}

	function attach(): void {
		if (attached) return;
		if (!canShare && !canCopy) return;
		const root = deps.document.documentElement;
		if (root.hasAttribute(OWNED_ATTR)) return;
		const wrap = pickElement(deps.document, "[data-share-balloon-wrap]");
		root.setAttribute(OWNED_ATTR, "");
		attached = true;
		deps.addSwapListener(onSwap);
		adopt(wrap);
	}

	function detach(): void {
		if (!attached) return;
		attached = false;
		deps.document.documentElement.removeAttribute(OWNED_ATTR);
		release();
		deps.removeSwapListener(onSwap);
	}

	return { attach, detach };
}
