import type { HighlightCopiedEvent } from "@packages/web-analytics";

export const COPY_STATUS_RESET_MS = 2000;
export const RAIL_COPY_STATUS_CLEAR_MS = 4000;
export const HAS_CLIPBOARD_CLASS = "has-clipboard";

export const COPY_ATTRIBUTE = "data-highlight-copy";
export const COPY_FAILED_CLASS = "highlight-copy-status--failed";
export const RAIL_COPY_ATTRIBUTE = "data-highlight-rail-copy";

const COPY_SELECTOR = `[${COPY_ATTRIBUTE}]`;
const PANEL_ATTRIBUTE = "data-highlight-popover";
const STATUS_SELECTOR = "[data-highlight-copy-status]";
const LIVE_REGION_ID = "toast-live-region";
const TOOLBAR_SELECTOR = "[data-highlight-toolbar]";
const COPIED_URL_ATTRIBUTE = "data-highlight-copied-url";
const COPY_ORIGIN: HighlightCopiedEvent["origin"] = "panel";
const RAIL_COPY_SELECTOR = `[${RAIL_COPY_ATTRIBUTE}]`;
const RAIL_ROW_SELECTOR = "[data-highlight-copy-source]";
const RAIL_EXCERPT_SELECTOR = ".highlights-rail__excerpt";
const RAIL_STATUS_SELECTOR = "[data-highlight-rail-copy-status]";
const RAIL_HIGHLIGHT_ATTRIBUTE = "data-highlight-row";

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

	const announce = (input: { status: HTMLElement; message: string }): void => {
		input.status.textContent = input.message;
		input.status.hidden = input.message === "";
		const region = document.getElementById(LIVE_REGION_ID);
		assert(region, "every page carries the toast live region");
		region.textContent = input.message;
	};

	const show = (input: { status: HTMLElement; outcome: "copied" | "failed" }): void => {
		const message = input.status.getAttribute(input.outcome === "copied" ? "data-copied-text" : "data-copy-failed-text");
		assert(message, `the copy status carries its ${input.outcome} text`);
		if (pendingReset !== undefined) deps.clearTimeoutFn(pendingReset);
		input.status.classList.toggle(COPY_FAILED_CLASS, input.outcome === "failed");
		announce({ status: input.status, message });
		pendingReset = deps.setTimeoutFn(() => {
			pendingReset = undefined;
			announce({ status: input.status, message: "" });
		}, COPY_STATUS_RESET_MS);
	};

	const beacon = (input: { toolbar: Element; highlightId: string }): void => {
		const rendered = input.toolbar.getAttribute(COPIED_URL_ATTRIBUTE);
		assert(rendered, "the highlight toolbar names its copied beacon");
		const url = new URL(rendered, document.baseURI);
		url.searchParams.set("highlight", input.highlightId);
		url.searchParams.set("origin", COPY_ORIGIN);
		deps.sendBeacon(`${url.pathname}${url.search}`);
	};

	let railClearing: unknown;

	const railStatusOf = (): Element => {
		const status = document.querySelector(RAIL_STATUS_SELECTOR);
		assert(status, "a page with Highlights rail copy buttons renders the rail copy status region");
		return status;
	};

	const announceRail = (input: { status: Element; textAttribute: string }): void => {
		deps.clearTimeoutFn(railClearing);
		input.status.textContent = input.status.getAttribute(input.textAttribute);
		railClearing = deps.setTimeoutFn(() => {
			input.status.textContent = "";
		}, RAIL_COPY_STATUS_CLEAR_MS);
	};

	const railBeacon = (input: { status: Element; row: Element }): void => {
		const rendered = input.status.getAttribute("data-copied-url");
		assert(rendered, "the rail copy status region names its copied beacon");
		const url = new URL(rendered, document.baseURI);
		const highlightId = input.row.getAttribute(RAIL_HIGHLIGHT_ATTRIBUTE);
		if (highlightId !== null) url.searchParams.set("highlight", highlightId);
		deps.sendBeacon(`${url.pathname}${url.search}`);
	};

	const copyRailRow = (button: Element): void => {
		const row = button.closest(RAIL_ROW_SELECTOR);
		assert(row, "a Highlights rail copy button sits in a highlight row");
		const excerpt = row.querySelector(RAIL_EXCERPT_SELECTOR);
		assert(excerpt, "a highlight row holds its excerpt");
		const text = excerpt.textContent;
		assert(text !== null, "an element always has text content");
		clipboard.writeText(text).then(
			() => {
				const status = railStatusOf();
				announceRail({ status, textAttribute: "data-copied-text" });
				railBeacon({ status, row });
			},
			() => {
				const selection = document.getSelection();
				assert(selection, "a live document always has a selection");
				selection.selectAllChildren(excerpt);
				announceRail({ status: railStatusOf(), textAttribute: "data-copy-failed-text" });
			},
		);
	};

	document.addEventListener("click", (event) => {
		const path = event.composedPath().filter(isElement);
		const railButton = path.find((element) => element.matches(RAIL_COPY_SELECTOR));
		if (railButton !== undefined) {
			copyRailRow(railButton);
			return;
		}
		const button = path.find((element) => element.matches(COPY_SELECTOR));
		if (button === undefined) return;
		const text = button.getAttribute(COPY_ATTRIBUTE);
		assert(text, "a Copy highlight item carries its highlight's text");
		const panel = button.closest(`[${PANEL_ATTRIBUTE}]`);
		assert(panel, "a Copy highlight item sits in its highlight's panel");
		const highlightId = panel.getAttribute(PANEL_ATTRIBUTE);
		assert(highlightId, "a highlight's panel names its highlight");
		const status = document.querySelector<HTMLElement>(STATUS_SELECTOR);
		assert(status, "a page that offers Copy highlight renders its copy status");
		const toolbar = document.querySelector(TOOLBAR_SELECTOR);
		assert(toolbar, "a page that offers Copy highlight renders the highlight toolbar");
		clipboard.writeText(text).then(
			() => {
				show({ status, outcome: "copied" });
				beacon({ toolbar, highlightId });
			},
			() => show({ status, outcome: "failed" }),
		);
	});
}
