import { PAGE_DEPTH_FIELDS } from "./page-depth-tracking";

/**
 * Reports how far down the page a reader actually got before leaving it.
 *
 * Every browser global arrives injected — including the DOM narrowing behind
 * `anchorHrefFromEvent` — so the module is a pure function of its dependencies
 * and a test can drive it without a real window. The composition root that
 * supplies the real globals is the bundle footer.
 */
export interface PageDepthDeps {
	addClickListener: (listener: (event: Event) => void) => void;
	addSubmitListener: (listener: () => void) => void;
	addScrollListener: (listener: () => void) => void;
	/** Fires when the page is going away, and only then: the caller decides
	 * whether a visibility change counts, so this module holds no branch a test
	 * would have to fake a `visibilityState` to reach. */
	addLeaveListener: (listener: () => void) => void;
	anchorHrefFromEvent: (event: Event) => string | null;
	scrollY: () => number;
	viewportHeight: () => number;
	/** Read at send time, not at load: a page whose height settles late — a web
	 * font, a poster frame — would otherwise be measured against a height it
	 * never had. */
	documentHeight: () => number;
	sendBeacon: (url: string) => void;
	beaconUrl: string;
	exitKinds: { leftSite: string; navigatedOnward: string };
}

/** A same-origin destination the reader chose, as opposed to closing the tab.
 * Root-relative only, matching the hrefs every in-site link is built with. */
function isInternalHref(href: string | null): boolean {
	if (href === null) return false;
	return href.startsWith("/") && !href.startsWith("//");
}

export function initPageDepth(deps: PageDepthDeps): void {
	let deepest = 0;
	let navigatedOnward = false;
	let sent = false;

	function recordDepth(): void {
		const bottom = deps.scrollY() + deps.viewportHeight();
		if (bottom > deepest) deepest = bottom;
	}

	function send(): void {
		if (sent) return;
		sent = true;
		const params = new URLSearchParams({
			[PAGE_DEPTH_FIELDS.deepest]: String(Math.round(deepest)),
			[PAGE_DEPTH_FIELDS.height]: String(Math.round(deps.documentHeight())),
			[PAGE_DEPTH_FIELDS.viewport]: String(Math.round(deps.viewportHeight())),
			[PAGE_DEPTH_FIELDS.exit]: navigatedOnward
				? deps.exitKinds.navigatedOnward
				: deps.exitKinds.leftSite,
		});
		const separator = deps.beaconUrl.includes("?") ? "&" : "?";
		deps.sendBeacon(`${deps.beaconUrl}${separator}${params.toString()}`);
	}

	deps.addClickListener((event) => {
		if (isInternalHref(deps.anchorHrefFromEvent(event))) navigatedOnward = true;
	});
	deps.addSubmitListener(() => {
		navigatedOnward = true;
	});
	deps.addScrollListener(recordDepth);
	deps.addLeaveListener(send);

	recordDepth();
}
