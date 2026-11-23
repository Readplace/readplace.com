import type { HighlightCopiedEvent } from "@packages/web-analytics";

export const COPY_STATUS_RESET_MS = 2000;
export const HAS_CLIPBOARD_CLASS = "has-clipboard";

const COPY_SELECTOR = "[data-highlight-copy]";
const PANEL_ATTRIBUTE = "data-highlight-popover";
const STATUS_SELECTOR = "[data-highlight-copy-status]";
const LIVE_REGION_ID = "toast-live-region";
const TOOLBAR_SELECTOR = "[data-highlight-toolbar]";
const COPIED_URL_ATTRIBUTE = "data-highlight-copied-url";
const COPY_ORIGIN: HighlightCopiedEvent["origin"] = "panel";

interface HighlightCopyNavigator {
	clipboard?: { writeText(text: string): Promise<void> };
}

export interface HighlightCopyDeps {
	document: Document;
	navigator: HighlightCopyNavigator;
	setTimeoutFn: (callback: () => void, delayMs: number) => unknown;
	clearTimeoutFn: (handle: unknown) => void;
	sendBeacon: (url: string) => void;
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function isElement(target: unknown): target is Element {
	return typeof Reflect.get(Object(target), "closest") === "function";
}

export function initHighlightCopy(deps: HighlightCopyDeps): void {
	const { document } = deps;
	const clipboard = deps.navigator.clipboard;
	const root = document.documentElement;
	if (clipboard === undefined || root.classList.contains(HAS_CLIPBOARD_CLASS)) return;
	root.classList.add(HAS_CLIPBOARD_CLASS);
	let pendingReset: unknown;

	const announce = (message: string): void => {
		const status = document.querySelector<HTMLElement>(STATUS_SELECTOR);
		assert(status, "a page that offers Copy highlight renders its copy status");
		status.textContent = message;
		status.hidden = message === "";
		const region = document.getElementById(LIVE_REGION_ID);
		assert(region, "every page carries the toast live region");
		region.textContent = message;
	};

	const show = (input: { attribute: "data-copied-text" | "data-copy-failed-text" }): void => {
		const status = document.querySelector(STATUS_SELECTOR);
		assert(status, "a page that offers Copy highlight renders its copy status");
		const message = status.getAttribute(input.attribute);
		assert(message, `the copy status carries ${input.attribute}`);
		if (pendingReset !== undefined) deps.clearTimeoutFn(pendingReset);
		announce(message);
		pendingReset = deps.setTimeoutFn(() => {
			pendingReset = undefined;
			announce("");
		}, COPY_STATUS_RESET_MS);
	};

	const beacon = (highlightId: string): void => {
		const toolbar = document.querySelector(TOOLBAR_SELECTOR);
		assert(toolbar, "a page that offers Copy highlight renders the highlight toolbar");
		const rendered = toolbar.getAttribute(COPIED_URL_ATTRIBUTE);
		assert(rendered, "the highlight toolbar names its copied beacon");
		const url = new URL(rendered, document.baseURI);
		url.searchParams.set("highlight", highlightId);
		url.searchParams.set("origin", COPY_ORIGIN);
		deps.sendBeacon(`${url.pathname}${url.search}`);
	};

	document.addEventListener("click", (event) => {
		const button = event.composedPath().filter(isElement).find((element) => element.matches(COPY_SELECTOR));
		if (button === undefined) return;
		const text = button.getAttribute("data-highlight-copy");
		assert(text, "a Copy highlight item carries its highlight's text");
		const panel = button.closest(`[${PANEL_ATTRIBUTE}]`);
		assert(panel, "a Copy highlight item sits in its highlight's panel");
		const highlightId = panel.getAttribute(PANEL_ATTRIBUTE);
		assert(highlightId, "a highlight's panel names its highlight");
		clipboard.writeText(text).then(
			() => {
				show({ attribute: "data-copied-text" });
				beacon(highlightId);
			},
			() => show({ attribute: "data-copy-failed-text" }),
		);
	});
}
