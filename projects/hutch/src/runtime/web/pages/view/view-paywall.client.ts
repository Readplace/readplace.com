import { PAYWALL_REVEALED_EVENT } from "../../shared/paywall-revealed-event";

interface ViewPaywallWindow {
	readonly scrollY: number;
	addEventListener(
		type: "scroll",
		listener: () => void,
		options: { passive: true },
	): void;
	removeEventListener(type: "scroll", listener: () => void): void;
}

interface ViewPaywallDeps {
	document: Document;
	window: ViewPaywallWindow;
	now: () => number;
	setTimeoutFn: (cb: () => void, ms: number) => unknown;
	clearTimeoutFn: (id: unknown) => void;
	dispatchDocumentEvent: (type: string) => void;
}

/** The expired-public-reader paywall is a soft, scroll-gated blur. The element
 * ships hidden (`--inactive`); this reveals it once two gates are both open:
 * the reader has scrolled past 10% of the article (so the blur engages over the
 * content below the current reading line, not on load) AND public access has
 * expired (data-expires-at is in the past, immediately for SSR-expired pages or
 * the moment a counting page's deadline arrives). Both orderings are handled —
 * a reader who scrolls first sees the blur the instant the deadline passes, and
 * a reader on an already-expired page sees it the moment they scroll. Once
 * revealed it latches: the scroll listener detaches and the deadline timer
 * clears, so scrolling back up does not un-blur. Absent on permanent / prod /
 * not-ready pages (no element) — no-op. */
export function initViewPaywall(deps: ViewPaywallDeps): void {
	const root = deps.document.querySelector("[data-view-paywall]");
	if (root === null) return;
	const expiresAtRaw = root.getAttribute("data-expires-at");
	if (expiresAtRaw === null) return;
	const deadlineMs = Date.parse(expiresAtRaw);
	if (!Number.isFinite(deadlineMs)) return;
	const articleEl = deps.document.querySelector<HTMLElement>("[data-article-body]");
	if (articleEl === null) return;
	// TS doesn't propagate the null-narrowing above into the nested closures below.
	const paywall = root;
	const article = articleEl;

	let scrolledPast = false;
	let timerId: unknown = null;

	function reveal(): void {
		if (!scrolledPast) return;
		if (deps.now() < deadlineMs) return;
		paywall.classList.remove("view__paywall--inactive");
		paywall.classList.add("view__paywall--active");
		paywall.setAttribute("data-paywall-active", "true");
		deps.window.removeEventListener("scroll", onScroll);
		if (timerId !== null) {
			deps.clearTimeoutFn(timerId);
			timerId = null;
		}
		deps.dispatchDocumentEvent(PAYWALL_REVEALED_EVENT);
	}

	function onScroll(): void {
		const threshold = article.offsetHeight * 0.1;
		if (deps.window.scrollY < threshold) return;
		scrolledPast = true;
		reveal();
	}

	deps.window.addEventListener("scroll", onScroll, { passive: true });

	const msUntilDeadline = deadlineMs - deps.now();
	if (msUntilDeadline > 0) {
		timerId = deps.setTimeoutFn(reveal, msUntilDeadline);
	}
	onScroll(); // page may have loaded mid-scroll
}
