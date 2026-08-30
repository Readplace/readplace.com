import { SAVE_TIP_COOKIE_NAME, SAVE_TIP_SEEN } from "./save-tip-cookie";

export interface SaveTipDeps {
	document: Document;
	supportsPopover: () => boolean;
	showPopover: (panel: Element) => void;
	hidePopover: (panel: Element) => void;
	navigate: (href: string) => void;
	isSecureTransport: () => boolean;
	writeCookie: (cookie: string) => void;
	sendBeacon: (url: string) => void;
}

/** The link the panel is holding back, waiting to be followed. The panel travels
 * with it so the proceed control never has to look one up that may not be there. */
interface PendingNavigation {
	panel: Element;
	href: string;
}

const PANEL_ID = "save-tip";
const STATE_ATTRIBUTE = "data-save-tip";
const DUE_SELECTOR = `[${STATE_ATTRIBUTE}='due']`;
const DUE_FORM_SELECTOR = `form${DUE_SELECTOR}`;
const URL_INPUT_SELECTOR = "input[type='url']";
const PROCEED_SELECTOR = "[data-save-tip-proceed]";
const BEACON_ATTRIBUTE = "data-beacon-url";
const CONTROL_BEACON_SELECTOR = `#${PANEL_ID} [${BEACON_ATTRIBUTE}]`;

function isElement(node: EventTarget | null): node is Element {
	return typeof Reflect.get(Object(node), "closest") === "function";
}

export function initSaveTip(deps: SaveTipDeps): void {
	let pendingNavigation: PendingNavigation | null = null;
	let pointerPressed = false;
	let showDeferred = false;

	function openablePanel(): Element | null {
		if (!deps.supportsPopover()) return null;
		return deps.document.getElementById(PANEL_ID);
	}

	function seenCookie(): string {
		const cookie = `${SAVE_TIP_COOKIE_NAME}=${SAVE_TIP_SEEN}; path=/; samesite=lax`;
		return deps.isSecureTransport() ? `${cookie}; secure` : cookie;
	}

	function recordBeacon(element: Element | null): void {
		const url = element === null ? null : element.getAttribute(BEACON_ATTRIBUTE);
		if (url === null) return;
		deps.sendBeacon(url);
	}

	function openTip(panel: Element): void {
		deps.document.querySelectorAll(DUE_FORM_SELECTOR).forEach((form) => {
			form.setAttribute(STATE_ATTRIBUTE, SAVE_TIP_SEEN);
		});
		deps.writeCookie(seenCookie());
		deps.showPopover(panel);
		recordBeacon(panel);
	}

	deps.document.addEventListener("pointerdown", () => {
		pointerPressed = true;
		// A press that opens a context menu or releases off-target produces no
		// click, so its deferral would otherwise ride along to the next click.
		showDeferred = false;
	});

	deps.document.addEventListener("pointerup", () => {
		pointerPressed = false;
	});

	deps.document.addEventListener("pointercancel", () => {
		pointerPressed = false;
		showDeferred = false;
	});

	deps.document.addEventListener("focusout", () => {
		showDeferred = false;
	});

	deps.document.addEventListener("focusin", (event) => {
		const target = event.target;
		if (!isElement(target)) return;
		if (!target.matches(URL_INPUT_SELECTOR)) return;
		if (target.closest(DUE_FORM_SELECTOR) === null) return;
		const panel = openablePanel();
		if (panel === null) return;
		// A panel opened before the pointer is released is dismissed by the very
		// click that focused the box, so a pointer-driven focus waits for it.
		if (pointerPressed) {
			showDeferred = true;
			return;
		}
		openTip(panel);
	});

	deps.document.addEventListener("click", (event) => {
		if (showDeferred) {
			showDeferred = false;
			// Re-resolved rather than carried from focusin: a swap landing
			// mid-press replaces the panel, and only one in the document opens.
			const panel = openablePanel();
			if (panel !== null) openTip(panel);
		}

		const target = event.target;
		if (!isElement(target)) return;

		recordBeacon(target.closest(CONTROL_BEACON_SELECTOR));

		if (target.closest(PROCEED_SELECTOR) !== null) {
			const accepted = pendingNavigation;
			pendingNavigation = null;
			if (accepted === null) return;
			deps.hidePopover(accepted.panel);
			deps.navigate(accepted.href);
			return;
		}

		if (event.defaultPrevented) return;
		if (event.button !== 0) return;
		if ([event.metaKey, event.ctrlKey, event.shiftKey, event.altKey].includes(true)) return;
		const link = target.closest<HTMLAnchorElement>(`a${DUE_SELECTOR}`);
		if (link === null) return;
		const panel = openablePanel();
		if (panel === null) return;
		event.preventDefault();
		pendingNavigation = { panel, href: link.href };
		deps.writeCookie(seenCookie());
		deps.showPopover(panel);
		recordBeacon(panel);
	});
}
